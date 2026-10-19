import { actorOf, buildEvaluation, PEOPLE, seedPlanned, seedReviewed, seedSelfSubmitted } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('Thông báo của evaluation (ADR-029)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('mỗi bước chuyển hồ sơ báo đúng người của bước kế tiếp, không nêu điểm hay xếp loại', async () => {
    const { evaluation } = await seedReviewed(h);
    expect(h.notifier.of('EVAL_SELF_SUBMITTED')).toEqual([expect.objectContaining({ to: [PEOPLE.head], link: `/evaluations/${evaluation.id}` })]);
    expect(h.notifier.of('EVAL_REVIEWED')).toEqual([expect.objectContaining({ to: [PEOPLE.deputy] })]);

    await h.service.approve(actorOf('deputy'), evaluation.id, 'Đồng ý');
    expect(h.notifier.of('EVAL_APPROVED')).toEqual([expect.objectContaining({ to: [PEOPLE.staff] })]);

    const text = JSON.stringify(h.notifier.sent);
    expect(text).not.toMatch(/\d{2}[.,]?\d* điểm|Xuất sắc|XUAT_SAC|Hoàn thành tốt/);
    expect(h.notifier.sent.every((s) => s.title.includes('2026-Q3'))).toBe(true);
  });

  it('trả hồ sơ về: báo người được đánh giá, không nêu lý do', async () => {
    const { evaluation } = await seedSelfSubmitted(h);
    await h.service.returnEvaluation(actorOf('head'), evaluation.id, 'Cần bổ sung minh chứng');
    expect(h.notifier.of('EVAL_RETURNED')).toEqual([expect.objectContaining({ to: [PEOPLE.staff] })]);
    expect(JSON.stringify(h.notifier.sent)).not.toContain('minh chứng');
  });

  it('thao tác bị từ chối thì không có thông báo', async () => {
    const { evaluation } = await seedPlanned(h);
    await expect(h.service.approve(actorOf('deputy'), evaluation.id)).rejects.toThrow();
    await expect(h.service.selfSubmit(actorOf('other'), evaluation.id, { generalScore: 20 })).rejects.toThrow();
    expect(h.notifier.sent).toEqual([]);
  });
});
