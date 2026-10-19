import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { actorOf, buildTasking, PEOPLE, seedTask } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const base = { catalogItemCode: 'B.009', plannedQuantity: 3, dueDate: '2026-10-20', periodMode: 'AUTO' as const };

/** `staff` giữ vị trí chính pos-staff (cấp trên: head) và kiêm nhiệm pos-lead (cấp trên: other > deputy). */
async function withConcurrent(): Promise<Harness> {
  const h = await buildTasking();
  h.org.placements.set(PEOPLE.staff, { unitId: 'unit-1', positionId: 'pos-staff' });
  h.org.concurrent.set(PEOPLE.staff, [{ unitId: 'unit-2', positionId: 'pos-lead' }]);
  h.org.positionChains.set('pos-lead', [PEOPLE.other, PEOPLE.deputy]);
  return h;
}

describe('Giao việc cho cán bộ kiêm nhiệm (ADR-047)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await withConcurrent();
  });

  it('người nhận kiêm nhiệm nhiều vị trí thì bắt buộc chọn việc thuộc vị trí nào', async () => {
    const task = await seedTask(h);
    await expect(h.service.assign(actorOf('head'), { ...base, taskId: task.id })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.assign(actorOf('head'), { ...base, taskId: task.id })).rejects.toThrow(/nhiều vị trí/);
  });

  it('ghi vị trí lên việc; chỉ cấp trên của đúng vị trí đó mới giao được', async () => {
    const task = await seedTask(h);
    const main = await h.service.assign(actorOf('head'), { ...base, taskId: task.id, positionId: 'pos-staff' });
    expect(main.assignment.positionId).toBe('pos-staff');
    expect(main.confirmerPersonId).toBe(PEOPLE.head);

    await expect(h.service.assign(actorOf('head'), { ...base, taskId: task.id, positionId: 'pos-lead' })).rejects.toBeInstanceOf(ForbiddenException);
    const extra = await h.service.assign(actorOf('other'), { ...base, taskId: task.id, positionId: 'pos-lead' });
    expect(extra.assignment.positionId).toBe('pos-lead');
    expect(extra.confirmerPersonId).toBe(PEOPLE.other);
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.assignment.create', details: { positionId: 'pos-lead' } });
  });

  it('vị trí không thuộc người nhận bị từ chối', async () => {
    const task = await seedTask(h);
    await expect(h.service.assign(actorOf('head'), { ...base, taskId: task.id, positionId: 'pos-khac' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('người chỉ giữ một vị trí: tự lấy vị trí đó, không cần chọn; không có vị trí thì để trống', async () => {
    h.org.placements.set(PEOPLE.other, { unitId: 'unit-1', positionId: 'pos-other' });
    const task = await seedTask(h, 'head', PEOPLE.other);
    const v = await h.service.assign(actorOf('head'), { ...base, taskId: task.id });
    expect(v.assignment.positionId).toBe('pos-other');

    h.org.placements.delete(PEOPLE.other);
    const w = await h.service.assign(actorOf('head'), { ...base, taskId: task.id });
    expect(w.assignment.positionId).toBeNull();
  });

  it('thẩm quyền theo vị trí của việc: người xác nhận, người duyệt, thành viên', async () => {
    const task = await seedTask(h);
    const extra = await h.service.assign(actorOf('other'), { ...base, taskId: task.id, positionId: 'pos-lead' });
    const a = extra.assignment;
    expect(await h.service.membership(actorOf('other'), a)).toMatchObject({ assigner: true });
    expect(await h.service.membership(actorOf('head'), a)).toMatchObject({ assigner: false, approver: false });
    expect(await h.service.membership(actorOf('staff'), a)).toMatchObject({ assignee: true });
    // Người duyệt (cc) chọn trong chuỗi cấp trên của vị trí kiêm nhiệm, không phải của vị trí chính.
    await expect(h.service.assign(actorOf('other'), { ...base, taskId: task.id, positionId: 'pos-lead', approverPersonId: PEOPLE.boss })).rejects.toBeInstanceOf(BadRequestException);
    const withApprover = await h.service.assign(actorOf('other'), { ...base, taskId: task.id, positionId: 'pos-lead', approverPersonId: PEOPLE.deputy });
    expect(withApprover.approverPersonId).toBe(PEOPLE.deputy);
  });

  it('cấp trên của vị trí chính không xem được việc của vị trí kiêm nhiệm', async () => {
    const task = await seedTask(h);
    const extra = await h.service.assign(actorOf('other'), { ...base, taskId: task.id, positionId: 'pos-lead' });
    await expect(h.service.get(actorOf('head'), extra.assignment.id, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.get(actorOf('other'), extra.assignment.id, false)).resolves.toBeDefined();
  });

  it('đề xuất việc đột xuất của người kiêm nhiệm: mặc định vị trí chính, hoặc vị trí được chọn và do cấp trên vị trí đó duyệt', async () => {
    const asMain = await h.service.propose(actorOf('staff'), { title: 'Việc gấp A', plannedQuantity: 1, dueDate: '2026-10-20' });
    expect(asMain.assignment).toMatchObject({ status: 'PROPOSED', positionId: 'pos-staff' });
    expect(h.notifier.of('TASK_PROPOSED').at(-1)?.to).toContain(PEOPLE.head);

    const asLead = await h.service.propose(actorOf('staff'), { title: 'Việc gấp B', plannedQuantity: 1, dueDate: '2026-10-20', positionId: 'pos-lead' });
    expect(asLead.assignment.positionId).toBe('pos-lead');
    await expect(h.service.approveProposal(actorOf('head'), asLead.assignment.id, { difficulty: 2 })).rejects.toBeInstanceOf(ForbiddenException);
    const approved = await h.service.approveProposal(actorOf('other'), asLead.assignment.id, { difficulty: 2 });
    expect(approved.assignment).toMatchObject({ status: 'OPEN', positionId: 'pos-lead' });
  });

  it('việc thu thập cho kỳ mang theo vị trí để vào đúng phiếu', async () => {
    const task = await seedTask(h);
    await h.service.assign(actorOf('head'), { ...base, taskId: task.id, positionId: 'pos-staff', dueDate: '2026-10-10' });
    await h.service.assign(actorOf('other'), { ...base, taskId: task.id, positionId: 'pos-lead', dueDate: '2026-10-11' });
    const works = await h.service.collectForPeriod({ type: 'MONTH', startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(works.map((w) => w.positionId).sort()).toEqual(['pos-lead', 'pos-staff']);
  });
});
