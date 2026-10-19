import { excellentQuota, quotaGroupKey, quotaMessage } from './excellent-quota.js';
import type { QuotaRow } from './excellent-quota.js';
import type { Rating } from '../../scoring/index.js';

const row = (id: string, score: number, rating: Rating): QuotaRow => ({ evaluationId: id, personId: `p-${id}`, score, rating });
const many = (n: number, rating: Rating, base = 80): QuotaRow[] => Array.from({ length: n }, (_, i) => row(`${rating}-${i}`, base + (i % 5), rating));

describe('hạn mức xuất sắc của cá nhân (ADR-060)', () => {
  it('trong hạn mức 20% số hoàn thành tốt: không vượt, không cảnh báo', () => {
    const q = excellentQuota([...many(10, 'HOAN_THANH_TOT'), row('a', 95, 'XUAT_SAC'), row('b', 93, 'XUAT_SAC')], 20);
    expect(q).toMatchObject({ excellent: 2, good: 10, allowed: 2, exceeded: false });
    expect(quotaMessage(q, q.ranking[0])).toBeNull();
  });

  it('vượt hạn mức: lấy từ điểm cao xuống thấp, người thấp điểm nằm ngoài', () => {
    const rows = [...many(10, 'HOAN_THANH_TOT'), row('a', 97, 'XUAT_SAC'), row('b', 94, 'XUAT_SAC'), row('c', 92, 'XUAT_SAC'), row('d', 91, 'XUAT_SAC')];
    const q = excellentQuota(rows, 20);
    // k xuất sắc giữ lại sao cho k ≤ 20% × (10 + 4 − k): k = 2 (2 ≤ 2,4); k = 3 (3 ≤ 2,2) không đạt.
    expect(q.allowed).toBe(2);
    expect(q.exceeded).toBe(true);
    expect(q.ranking.map((r) => [r.evaluationId, r.rank, r.within])).toEqual([
      ['a', 1, true],
      ['b', 2, true],
      ['c', 3, false],
      ['d', 4, false],
    ]);
    expect(quotaMessage(q, q.ranking[2])).toMatch(/Vượt hạn mức xuất sắc.*thứ 3\/4.*nằm ngoài hạn mức/);
    expect(quotaMessage(q, q.ranking[0])).toMatch(/nằm trong hạn mức/);
  });

  it('mức 25% cho đơn vị nổi trội cao hơn 20%', () => {
    const q = excellentQuota([...many(16, 'HOAN_THANH_TOT'), ...many(4, 'XUAT_SAC', 90)], 25);
    expect(q.allowed).toBe(3);
    expect(q.allowedExceptional).toBe(4);
  });

  it('hòa điểm ở ranh giới: cả hai bị đánh dấu để cấp có thẩm quyền xem xét', () => {
    const rows = [...many(10, 'HOAN_THANH_TOT'), row('a', 96, 'XUAT_SAC'), row('b', 92, 'XUAT_SAC'), row('c', 92, 'XUAT_SAC')];
    const q = excellentQuota(rows, 15);
    expect(q.allowed).toBe(2);
    expect(q.ranking.filter((r) => r.tie).map((r) => r.evaluationId).sort()).toEqual(['b', 'c']);
    expect(quotaMessage(q, q.ranking.find((r) => r.evaluationId === 'c'))).toMatch(/bằng điểm người ở ranh giới/);
  });

  it('nhóm từ 5 người trở xuống được chọn 1 người dù tỉ lệ cho 0; người điểm cao nhất được chọn', () => {
    const q = excellentQuota([row('a', 93, 'XUAT_SAC'), row('b', 91, 'XUAT_SAC'), row('c', 80, 'HOAN_THANH_TOT')], 4);
    expect(q).toMatchObject({ smallGroup: true, allowed: 1, exceeded: true });
    expect(q.ranking.map((r) => r.within)).toEqual([true, false]);
    expect(quotaMessage(q, q.ranking[1])).toMatch(/từ 5 người trở xuống được chọn 1 người/);
  });

  it('nhóm lớn mà không có ai hoàn thành tốt thì không ai xuất sắc theo tỉ lệ; không có ai xuất sắc thì không có gì để nhắc', () => {
    const q = excellentQuota([row('a', 95, 'XUAT_SAC'), ...many(9, 'HOAN_THANH')], 10);
    expect(q).toMatchObject({ allowed: 0, exceeded: true, smallGroup: false });
    expect(excellentQuota(many(5, 'HOAN_THANH_TOT'), 12)).toMatchObject({ excellent: 0, exceeded: false, ranking: [] });
    expect(quotaMessage(excellentQuota([], 3), undefined)).toBeNull();
  });

  it('nhóm theo đơn vị và loại vị trí', () => {
    expect(quotaGroupKey({ unitId: 'u1', isLeader: true })).toBe('u1|LEADER');
    expect(quotaGroupKey({ unitId: 'u1', isSupport: true })).toBe('u1|SUPPORT');
    expect(quotaGroupKey({ unitId: 'u1' })).toBe('u1|STAFF');
    expect(quotaGroupKey({})).toBe('-|STAFF');
  });
});
