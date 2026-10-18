import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { actorOf, buildTasking, seedAssignment } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const REASON = 'Mất điện diện rộng toàn khu vực, có xác nhận của Văn phòng Tỉnh ủy';

describe('Miễn trừ do nguyên nhân khách quan (ADR-056, Nghị định 335/2025 Điều 14.2.b, c)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  /** Một việc, hạn 2026-09-20, một lần báo cáo trễ hạn đã được xác nhận. */
  async function lateConfirmed() {
    const { assignment } = await seedAssignment(h);
    const late = await h.service.report(actorOf('staff'), assignment.id, { quantity: 10, completedOn: '2026-09-25' });
    await h.service.decide(actorOf('head'), late.id, { decision: 'CONFIRM' });
    return { assignment, late };
  }

  const summaryOf = async (id: string) => (await h.service.get(actorOf('head'), id, false)).summary;

  it('người xác nhận miễn trừ một lần chậm: không còn bị tính chậm, số lần được miễn hiện riêng', async () => {
    const { assignment, late } = await lateConfirmed();
    expect(await summaryOf(assignment.id)).toMatchObject({ lateCount: 1, waivedLateCount: 0 });

    const waiver = await h.service.waive(actorOf('head'), late.id, REASON);
    expect(waiver).toMatchObject({ progressId: late.id, kind: 'LATE', reason: REASON, grantedBy: 'acc-head', revokedAt: null });
    expect(await summaryOf(assignment.id)).toMatchObject({ lateCount: 0, waivedLateCount: 1, confirmedQuantity: 10 });
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.waiver.grant', details: expect.objectContaining({ kind: 'LATE', reason: REASON }) });
  });

  it('miễn trừ lần chưa đạt (sai sót lớn) thì không bị trừ chất lượng', async () => {
    const { assignment } = await seedAssignment(h);
    const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 5, completedOn: '2026-09-10' });
    await h.service.decide(actorOf('head'), p.id, { decision: 'REJECT', note: 'Sai nội dung', majorError: true });
    expect(await summaryOf(assignment.id)).toMatchObject({ reworkCount: 1 });

    const waiver = await h.service.waive(actorOf('head'), p.id, REASON);
    expect(waiver.kind).toBe('REWORK');
    expect(await summaryOf(assignment.id)).toMatchObject({ reworkCount: 0, waivedReworkCount: 1 });
  });

  it('miễn trừ ngay khi duyệt: xác nhận báo cáo trễ kèm nguyên nhân khách quan', async () => {
    const { assignment } = await seedAssignment(h);
    const late = await h.service.report(actorOf('staff'), assignment.id, { quantity: 10, completedOn: '2026-09-25' });
    await h.service.decide(actorOf('head'), late.id, { decision: 'CONFIRM', objectiveReason: REASON });
    const view = await h.service.get(actorOf('head'), assignment.id, false);
    expect(view.summary).toMatchObject({ lateCount: 0, waivedLateCount: 1 });
    expect(view.waivers).toHaveLength(1);
  });

  it('nêu nguyên nhân khách quan cho báo cáo đúng hạn hoặc từ chối vì lý do nhỏ thì bị từ chối, và lần báo cáo vẫn chưa được xử lý', async () => {
    const { assignment } = await seedAssignment(h);
    const onTime = await h.service.report(actorOf('staff'), assignment.id, { quantity: 4, completedOn: '2026-09-20' });
    await expect(h.service.decide(actorOf('head'), onTime.id, { decision: 'CONFIRM', objectiveReason: REASON })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.decide(actorOf('head'), onTime.id, { decision: 'REJECT', note: 'Thiếu số liệu', majorError: false, objectiveReason: REASON })).rejects.toBeInstanceOf(BadRequestException);
    expect((await summaryOf(assignment.id)).pendingQuantity).toBe(4);
  });

  it('lần báo cáo đúng hạn không cần miễn trừ; nguyên nhân phải đủ rõ; không miễn trừ hai lần', async () => {
    const { assignment } = await seedAssignment(h);
    const onTime = await h.service.report(actorOf('staff'), assignment.id, { quantity: 4, completedOn: '2026-09-20' });
    await h.service.decide(actorOf('head'), onTime.id, { decision: 'CONFIRM' });
    await expect(h.service.waive(actorOf('head'), onTime.id, REASON)).rejects.toBeInstanceOf(BadRequestException);

    const { late } = await lateConfirmed();
    await expect(h.service.waive(actorOf('head'), late.id, 'ngắn')).rejects.toBeInstanceOf(BadRequestException);
    await h.service.waive(actorOf('head'), late.id, REASON);
    await expect(h.service.waive(actorOf('head'), late.id, REASON)).rejects.toBeInstanceOf(ConflictException);
  });

  it('chỉ người xác nhận kết quả của việc mới miễn trừ và thu hồi được; chính cán bộ và cấp trên xa hơn thì không', async () => {
    const { late } = await lateConfirmed();
    await expect(h.service.waive(actorOf('staff'), late.id, REASON)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.waive(actorOf('deputy'), late.id, REASON)).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.waive(actorOf('head'), late.id, REASON);
    await expect(h.service.revokeWaiver(actorOf('staff'), late.id, 'không còn căn cứ')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('thu hồi miễn trừ: lần chậm tính lại, bản ghi giữ nguyên kèm người và lý do thu hồi; có thể miễn trừ lại', async () => {
    const { assignment, late } = await lateConfirmed();
    await h.service.waive(actorOf('head'), late.id, REASON);
    await expect(h.service.revokeWaiver(actorOf('head'), late.id, ' ')).rejects.toBeInstanceOf(BadRequestException);

    const revoked = await h.service.revokeWaiver(actorOf('head'), late.id, 'Xác nhận ban đầu không đúng');
    expect(revoked).toMatchObject({ revokedBy: 'acc-head', revokeNote: 'Xác nhận ban đầu không đúng' });
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    expect(await summaryOf(assignment.id)).toMatchObject({ lateCount: 1, waivedLateCount: 0 });
    expect((await h.service.get(actorOf('head'), assignment.id, false)).waivers).toHaveLength(1);
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.waiver.revoke' });

    await expect(h.service.revokeWaiver(actorOf('head'), late.id, 'lần hai')).rejects.toBeInstanceOf(ConflictException);
    await h.service.waive(actorOf('head'), late.id, REASON);
    expect((await h.service.get(actorOf('head'), assignment.id, false)).waivers).toHaveLength(2);
    expect(await summaryOf(assignment.id)).toMatchObject({ lateCount: 0, waivedLateCount: 1 });
  });

  it('số liệu cho hồ sơ kỳ: lần được miễn không vào số lần chậm, nhưng được báo riêng', async () => {
    const { assignment, late } = await lateConfirmed();
    await h.service.waive(actorOf('head'), late.id, REASON);
    const [work] = await h.service.collectForPeriod({ type: 'MONTH', startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(work).toMatchObject({ assignmentId: assignment.id, lateCount: 0, waivedLateCount: 1, reworkCount: 0, waivedReworkCount: 0 });
  });

  it('báo cho cán bộ khi được miễn trừ và khi bị thu hồi', async () => {
    const { late } = await lateConfirmed();
    await h.service.waive(actorOf('head'), late.id, REASON);
    await h.service.revokeWaiver(actorOf('head'), late.id, 'Xác nhận không đúng');
    const sent = h.notifier.of('TASK_WAIVER');
    expect(sent).toHaveLength(2);
    expect(sent.every((n) => n.to.includes('p-staff'))).toBe(true);
    expect(sent[0].title).toContain('được miễn trừ');
    expect(sent[1].title).toContain('Miễn trừ đã bị thu hồi');
  });
});
