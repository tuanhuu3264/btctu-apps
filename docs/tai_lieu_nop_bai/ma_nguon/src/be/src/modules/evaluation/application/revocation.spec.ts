import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { actorOf, buildEvaluation, seedReviewed } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const NOTE = 'Phát hiện số liệu việc hoàn thành bị nhập thừa, kết quả không còn đúng';

describe('Hủy kết quả đã phê duyệt để xếp loại lại (ADR-059)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  /** Hồ sơ của staff đã phê duyệt: head thẩm định, deputy phê duyệt. */
  async function approved() {
    const seeded = await seedReviewed(h);
    await h.service.approve(actorOf('deputy'), seeded.evaluation.id, 'Đồng ý');
    return seeded;
  }

  it('người phê duyệt hủy: hồ sơ về bước giao mục tiêu, kết quả cũ lưu ở bản hủy, có nhật ký và thông báo không lộ điểm', async () => {
    const { evaluation } = await approved();
    const view = await h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'SAI_SO_LIEU', note: NOTE });

    expect(view.evaluation).toMatchObject({ status: 'PLANNED', totalScore: null, rating: null, approverAccountId: null, approvedAt: null, reviewerAccountId: null, generalScore: null });
    expect(view.evaluation.returnReason).toContain(NOTE);
    expect(view.revocations).toHaveLength(1);
    expect(view.revocations[0]).toMatchObject({ reasonCode: 'SAI_SO_LIEU', reason: NOTE, revokedBy: 'acc-deputy' });
    expect(view.revocations[0].previous).toMatchObject({ totalScore: 95, rating: 'XUAT_SAC', status: 'APPROVED', approveComment: 'Đồng ý' });
    expect((view.revocations[0].previous.tasks as unknown[]).length).toBe(2);
    expect(h.audit.at(-1)).toMatchObject({ action: 'evaluation.revoke', details: expect.objectContaining({ previousTotalScore: 95, previousRating: 'XUAT_SAC', reasonCode: 'SAI_SO_LIEU' }) });

    const sent = h.notifier.of('EVAL_REVOKED');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(expect.arrayContaining(['p-staff', 'p-head']));
    expect(sent[0].title).not.toMatch(/95|xuất sắc|XUAT_SAC/i); // tiêu đề không có điểm hay xếp loại cũ
  });

  it('xếp loại lại: cán bộ tự đánh giá lại, thẩm định, phê duyệt; bản hủy cũ vẫn còn', async () => {
    const { evaluation, t1, t2 } = await approved();
    await h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'KHONG_DU_DIEU_KIEN', note: NOTE });

    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 20, comment: 'Đánh giá lại' });
    await h.service.review(actorOf('head'), evaluation.id, {
      generalScore: 20,
      comment: 'Hạ mức',
      tasks: [
        { taskId: t1.id, qualityLevel: 2 },
        { taskId: t2.id, qualityLevel: 2 },
      ],
    });
    const again = await h.service.approve(actorOf('deputy'), evaluation.id, 'Đồng ý mức mới');
    expect(again.evaluation.status).toBe('APPROVED');
    expect(again.evaluation.totalScore).not.toBe(95);
    expect(again.revocations).toHaveLength(1);
    expect(again.revocations[0].previous.totalScore).toBe(95);
  });

  it('chỉ người phê duyệt hoặc cấp trên của người đó hủy được; người thẩm định, chính cán bộ, người ngoài thì không', async () => {
    const { evaluation } = await approved();
    const input = { reasonCode: 'KHAC' as const, note: NOTE };
    await expect(h.service.revoke(actorOf('head'), evaluation.id, input)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.revoke(actorOf('staff'), evaluation.id, input)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.revoke(actorOf('other'), evaluation.id, input)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.repos.evaluations.findById(evaluation.id))!.status).toBe('APPROVED');
    await expect(h.service.revoke(actorOf('boss'), evaluation.id, input)).resolves.toMatchObject({ evaluation: { status: 'PLANNED' } });
  });

  it('cần lý do hợp lệ và căn cứ đủ rõ; chỉ hồ sơ đã phê duyệt mới hủy được', async () => {
    const { evaluation } = await approved();
    await expect(h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'SAI_SO_LIEU', note: 'ngắn' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'LA' as 'KHAC', note: NOTE })).rejects.toBeInstanceOf(BadRequestException);

    // Hồ sơ chưa phê duyệt (đã trả về) không có gì để hủy.
    await h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'KHAC', note: NOTE });
    await expect(h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'KHAC', note: NOTE })).rejects.toBeInstanceOf(ConflictException);
  });

  it('kỳ đã đóng thì không hủy được', async () => {
    const { evaluation, period } = await approved();
    await h.service.closePeriod(period.id);
    await expect(h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'KHAC', note: NOTE })).rejects.toBeInstanceOf(ConflictException);
  });

  it('bản ghi hủy là chỉ ghi thêm: hủy hai lần giữ cả hai bản, mới nhất trước', async () => {
    const { evaluation, t1, t2 } = await approved();
    await h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'SAI_SO_LIEU', note: NOTE });
    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 26 });
    await h.service.review(actorOf('head'), evaluation.id, {
      generalScore: 25,
      tasks: [
        { taskId: t1.id, qualityLevel: 1 },
        { taskId: t2.id, qualityLevel: 2 },
      ],
    });
    await h.service.approve(actorOf('deputy'), evaluation.id);
    const second = await h.service.revoke(actorOf('deputy'), evaluation.id, { reasonCode: 'KY_LUAT_SAU', note: `${NOTE} (lần hai)` });
    expect(second.revocations.map((r) => r.reasonCode)).toEqual(['KY_LUAT_SAU', 'SAI_SO_LIEU']);
  });

  it('điểm tháng đã nằm trong hồ sơ năm đã phê duyệt: phải hủy hồ sơ năm trước', async () => {
    const { evaluation } = await approved();
    const actor = actorOf('head');
    const month = await h.service.createPeriod(actor, { type: 'MONTH', year: 2026, number: 9 });
    const year = await h.service.createPeriod(actor, { type: 'YEAR', year: 2026, number: null });
    const monthEval = await h.repos.evaluations.create({ periodId: month.id, personId: evaluation.personId, positionId: evaluation.positionId, createdBy: null });
    await h.repos.evaluations.update(monthEval.id, { status: 'APPROVED' });
    const yearEval = await h.repos.evaluations.create({ periodId: year.id, personId: evaluation.personId, positionId: evaluation.positionId, createdBy: null });
    await h.repos.evaluations.update(yearEval.id, { status: 'APPROVED' });

    await expect(h.service.revoke(actorOf('deputy'), monthEval.id, { reasonCode: 'KHAC', note: NOTE })).rejects.toThrow(/hủy hồ sơ năm trước/);
    // Hủy hồ sơ năm trước thì hủy tháng được.
    await h.service.revoke(actorOf('deputy'), yearEval.id, { reasonCode: 'KHAC', note: NOTE });
    await expect(h.service.revoke(actorOf('deputy'), monthEval.id, { reasonCode: 'KHAC', note: NOTE })).resolves.toMatchObject({ evaluation: { status: 'PLANNED' } });
  });
});
