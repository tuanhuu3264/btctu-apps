import { actorOf, buildEvaluation, seedReviewed } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('Khối hạn mức xuất sắc chỉ dành cho người thẩm định, người phê duyệt, người xem toàn bộ (ADR-060, AC-14.6)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('người được đánh giá không thấy khối hạn mức (không lộ điểm, thứ hạng của đồng nghiệp trong nhóm)', async () => {
    const { evaluation } = await seedReviewed(h);
    const own = await h.service.getEvaluation(actorOf('staff'), evaluation.id, false);
    expect(own.evaluation.rating).toBe('XUAT_SAC');
    expect(own.excellentQuota).toBeNull();
    expect(own.warnings.join(' ')).not.toMatch(/hạn mức/i);
  });

  it('người thẩm định và người phê duyệt thấy khối hạn mức của nhóm', async () => {
    const { evaluation } = await seedReviewed(h);
    const byReviewer = await h.service.getEvaluation(actorOf('head'), evaluation.id, false);
    const byApprover = await h.service.getEvaluation(actorOf('deputy'), evaluation.id, false);
    for (const v of [byReviewer, byApprover]) {
      expect(v.excellentQuota).not.toBeNull();
      expect(v.excellentQuota?.ranking.length).toBeGreaterThan(0);
    }
  });

  it('người có quyền xem toàn bộ (Văn phòng, Trưởng ban) thấy khối hạn mức', async () => {
    const { evaluation } = await seedReviewed(h);
    const v = await h.service.getEvaluation(actorOf('head'), evaluation.id, true);
    expect(v.excellentQuota).not.toBeNull();
  });
});
