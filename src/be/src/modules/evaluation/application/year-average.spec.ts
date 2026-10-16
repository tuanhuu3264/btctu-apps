import { averageYear, MIN_MONTHS_FOR_YEAR } from './year-average.js';
import type { MonthScore } from './year-average.js';

const month = (m: number, general: number, result: number): MonthScore => ({ month: m, label: `2026-${String(m).padStart(2, '0')}`, generalScore: general, resultScore: result, totalScore: general + result });

describe('điểm năm là trung bình cộng các tháng đã phê duyệt (Nghị định 335 Điều 17.3)', () => {
  it('đủ 12 tháng: trung bình điểm chung, điểm kết quả và tổng; xếp loại theo tổng', () => {
    const months = Array.from({ length: 12 }, (_, i) => month(i + 1, i % 2 === 0 ? 24 : 26, i % 2 === 0 ? 60 : 62));
    const y = averageYear(months);
    expect(y).toMatchObject({ enough: true, missing: [], generalScore: 25, resultScore: 61, totalScore: 86, rating: 'HOAN_THANH_TOT' });
  });

  it('tháng thiếu bị bỏ qua và được nêu; trung bình chỉ trên các tháng có', () => {
    const y = averageYear([1, 2, 3, 4, 5, 6, 8].map((m) => month(m, 25, 65)));
    expect(y.months).toHaveLength(7);
    expect(y.missing).toEqual([7, 9, 10, 11, 12]);
    expect(y).toMatchObject({ enough: true, totalScore: 90, rating: 'XUAT_SAC' });
  });

  it(`dưới ${MIN_MONTHS_FOR_YEAR} tháng thì không xếp loại (Điều 11.1) nhưng vẫn có điểm tham khảo`, () => {
    const y = averageYear([1, 2, 3, 4, 5].map((m) => month(m, 20, 40)));
    expect(y).toMatchObject({ enough: false, totalScore: 60, rating: null });
    expect(averageYear([month(1, 20, 40), month(2, 20, 40), month(3, 20, 40), month(4, 20, 40), month(5, 20, 40), month(6, 20, 40)]).rating).toBe('HOAN_THANH');
  });

  it('không có tháng nào thì mọi số đều trống, đủ 12 tháng đều thiếu', () => {
    expect(averageYear([])).toMatchObject({ enough: false, generalScore: null, resultScore: null, totalScore: null, rating: null, missing: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  });

  it('làm tròn hai chữ số thập phân và không phụ thuộc thứ tự đầu vào', () => {
    const a = averageYear([month(3, 25, 61.11), month(1, 24, 60.5), month(2, 26, 62.33), month(6, 25, 61), month(5, 25, 61), month(4, 25, 61)]);
    const b = averageYear([month(1, 24, 60.5), month(2, 26, 62.33), month(3, 25, 61.11), month(4, 25, 61), month(5, 25, 61), month(6, 25, 61)]);
    expect(a).toEqual(b);
    expect(a.resultScore).toBe(61.16);
    expect(a.totalScore).toBe(86.16);
  });

  it('ngưỡng 69,99 và 70 chia hai mức', () => {
    expect(averageYear([1, 2, 3, 4, 5, 6].map((m) => month(m, 20, 49.99))).rating).toBe('HOAN_THANH');
    expect(averageYear([1, 2, 3, 4, 5, 6].map((m) => month(m, 20, 50))).rating).toBe('HOAN_THANH_TOT');
  });
});

describe('tháng nghỉ có căn cứ và tổng hợp quý, 6 tháng (ADR-039)', () => {
  it('tháng nghỉ không tính vào trung bình và không bị coi là thiếu', () => {
    const y = averageYear([1, 2, 3, 4].map((m) => month(m, 25, 60)), [5, 6, 7]);
    expect(y.exempt).toEqual([5, 6, 7]);
    expect(y.missing).toEqual([8, 9, 10, 11, 12]);
    expect(y.months).toHaveLength(4);
    expect(y.totalScore).toBe(85);
  });

  it('ngưỡng 6 tháng tính cả tháng nghỉ, nhưng phải có ít nhất một tháng đã phê duyệt', () => {
    expect(averageYear([1, 2].map((m) => month(m, 25, 60)), [3, 4, 5, 6]).enough).toBe(true);
    expect(averageYear([1, 2].map((m) => month(m, 25, 60)), [3, 4, 5]).enough).toBe(false);
    const none = averageYear([], [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(none).toMatchObject({ enough: false, totalScore: null, rating: null });
  });

  it('tháng đã có hồ sơ phê duyệt thì không coi là tháng nghỉ; tháng ngoài 1–12 bị bỏ', () => {
    const y = averageYear([month(1, 25, 60)], [1, 0, 13, 2]);
    expect(y.exempt).toEqual([2]);
  });

  it('trung bình từng quý và 6 tháng đầu năm, quý thiếu tháng được đánh dấu', () => {
    const scores = [month(1, 25, 60), month(2, 27, 65), month(3, 26, 62), month(4, 20, 50), month(7, 28, 66)];
    const y = averageYear(scores, [5]);
    const by = Object.fromEntries(y.periods.map((p) => [p.key, p]));
    expect(by.Q1).toMatchObject({ approved: 3, complete: true, totalScore: 88.33, rating: 'HOAN_THANH_TOT' });
    expect(by.Q2).toMatchObject({ approved: 1, missing: [6], exempt: [5], complete: false, totalScore: 70, rating: 'HOAN_THANH_TOT' });
    expect(by.Q3).toMatchObject({ approved: 1, missing: [8, 9], totalScore: 94, rating: 'XUAT_SAC' });
    expect(by.Q4).toMatchObject({ approved: 0, totalScore: null, rating: null, complete: false });
    expect(by.H1).toMatchObject({ approved: 4, span: [1, 2, 3, 4, 5, 6], totalScore: 83.75 });
  });
});
