import { buildPeriod } from './period.js';
import { DEFAULT_SCORING_PARAMS, evaluate, kpiOf, leadershipRate, resultScore } from './scoring-policy.js';
import type { Leadership, ScoredTask } from './scoring-policy.js';
import { BadRequestException } from '@nestjs/common';

const task = (coefficient: number, planned: number, completed: number, qualityLevel: number | null, lateCount = 0, reworkCount = 0): ScoredTask => ({
  coefficient,
  plannedQuantity: planned,
  completedQuantity: completed,
  qualityLevel,
  lateCount,
  reworkCount,
});

describe('KPI theo Nghị định 335/2025/NĐ-CP Điều 14 đến 16: a số lượng, b chất lượng, c tiến độ, d đ e lãnh đạo', () => {
  it('hoàn thành đủ, không chậm, không làm lại thì A = B = C = 100% và được điểm tối đa', () => {
    expect(kpiOf([task(1, 10, 10, 1), task(2, 5, 5, 1)], null, false)).toEqual({ quantity: 1, quality: 1, timeliness: 1, leadership: null, kpi: 1 });
    expect(resultScore([task(1, 10, 10, 1), task(2, 5, 5, 1)])).toBe(70);
  });

  it('hệ số quy đổi: mức chất lượng 2 (cơ bản đáp ứng) không trừ điểm, chất lượng đo bằng số lần chưa đạt', () => {
    expect(kpiOf([task(1, 10, 10, 1), task(120 / 90, 3, 3, 2)], null, false)).toMatchObject({ quantity: 1, quality: 1, timeliness: 1 });
  });

  it('a, b, c cùng mẫu số là số lượng giao (Điều 14.2): làm một nửa, đạt chất lượng → (0,5 + 0,5 + 0,5) / 3', () => {
    expect(kpiOf([task(1, 10, 5, 1)], null, false)).toMatchObject({ quantity: 0.5, quality: 0.5, timeliness: 0.5, kpi: 0.5 });
    expect(resultScore([task(1, 10, 5, 1)])).toBe(35);
  });

  it('vượt mức không bù cho việc khác: số lượng đạt tối đa bằng số lượng giao của từng dòng', () => {
    expect(resultScore([task(1, 10, 25, 1)])).toBe(70);
    expect(kpiOf([task(1, 10, 20, 1), task(1, 10, 0, 1)], null, false).quantity).toBe(0.5);
  });

  it('mọi mức chất lượng đã đánh giá đều được tính (nghị định không có mức "không đáp ứng"); dòng chưa đánh giá thì không', () => {
    expect(resultScore([task(1, 10, 10, 3)])).toBe(70);
    expect(resultScore([task(1, 10, 10, null)])).toBe(0);
  });

  it('mỗi lần chưa đạt trừ 25% chất lượng của dòng đó, mỗi lần chậm trừ 25% tiến độ của dòng đó', () => {
    expect(kpiOf([task(1, 4, 4, 1, 0, 1)], null, false)).toMatchObject({ quantity: 1, quality: 0.75, timeliness: 1, kpi: 0.9167 });
    expect(resultScore([task(1, 4, 4, 1, 0, 1)])).toBe(64.17);
    expect(kpiOf([task(1, 4, 4, 1, 2, 0)], null, false)).toMatchObject({ quality: 1, timeliness: 0.5, kpi: 0.8333 });
    expect(resultScore([task(1, 4, 4, 1, 2, 0)])).toBe(58.33);
  });

  it('bị trừ đến mức không âm: nhiều lần chậm, chưa đạt không làm điểm thành số âm', () => {
    expect(kpiOf([task(1, 4, 4, 1, 5, 4)], null, false)).toMatchObject({ quantity: 1, quality: 0, timeliness: 0, kpi: 0.3333 });
  });

  it('trừ điểm theo dòng, theo hệ số: dòng nặng hơn ảnh hưởng nhiều hơn', () => {
    // dòng 1 (hệ số 1) sai sót lớn 1 lần; dòng 2 (hệ số 3) không: b = (1×4×0,75 + 3×4×1) / (1×4 + 3×4) = 15/16
    expect(kpiOf([task(1, 4, 4, 1, 0, 1), task(3, 4, 4, 1)], null, false).quality).toBe(0.9375);
  });

  it('cán bộ lãnh đạo, quản lý: KPI = (a + b + c + d + đ + e) / 6, mỗi tiêu chí lãnh đạo là một số hạng riêng (Điều 16.2)', () => {
    const leadership: Leadership = { unitResult: 1, organizing: 1, solidarity: 0.5 };
    expect(leadershipRate(leadership)).toBeCloseTo(0.8333, 4); // trung bình, chỉ để hiển thị
    expect(kpiOf([task(1, 10, 10, 1)], leadership, true)).toMatchObject({ leadership: 0.8333, kpi: 0.9167 }); // (3 + 2,5) / 6
    expect(resultScore([task(1, 10, 10, 1)], DEFAULT_SCORING_PARAMS, leadership, true)).toBe(64.17);
  });

  it('ba tiêu chí lãnh đạo cùng 50%: KPI = (3 + 1,5) / 6 = 0,75, không phải 0,875 như cách chia 4', () => {
    const leadership: Leadership = { unitResult: 0.5, organizing: 0.5, solidarity: 0.5 };
    expect(kpiOf([task(1, 10, 10, 1)], leadership, true).kpi).toBe(0.75);
    expect(resultScore([task(1, 10, 10, 1)], DEFAULT_SCORING_PARAMS, leadership, true)).toBe(52.5);
  });

  it('người không lãnh đạo thì bỏ d, đ, e dù có truyền vào; lãnh đạo chưa được chấm thì tạm tính theo a, b, c', () => {
    const leadership: Leadership = { unitResult: 0.5, organizing: 0.5, solidarity: 0.5 };
    expect(kpiOf([task(1, 10, 10, 1)], leadership, false)).toMatchObject({ leadership: null, kpi: 1 });
    expect(kpiOf([task(1, 10, 10, 1)], null, true)).toMatchObject({ leadership: null, kpi: 1 });
  });

  it('không có chỉ tiêu hoặc tổng giao bằng 0 thì 0 điểm, kể cả D, không chia cho 0', () => {
    expect(resultScore([])).toBe(0);
    expect(resultScore([task(0, 5, 5, 1)])).toBe(0);
    expect(kpiOf([], { unitResult: 1, organizing: 1, solidarity: 1 }, true)).toEqual({ quantity: 0, quality: 0, timeliness: 0, leadership: null, kpi: 0 });
  });

  it('làm tròn: điểm 2 chữ số, các thành phần 4 chữ số', () => {
    expect(kpiOf([task(1, 3, 2, 1)], null, false)).toMatchObject({ quantity: 0.6667, quality: 0.6667, timeliness: 0.6667, kpi: 0.6667 });
    expect(resultScore([task(1, 3, 2, 1)])).toBe(46.67);
  });

  it('nhận tham số khác (mức trừ mỗi lần 50%, trần 60)', () => {
    const params = { ...DEFAULT_SCORING_PARAMS, penaltyPerOccurrence: 0.5, resultMax: 60 };
    expect(kpiOf([task(1, 4, 4, 1, 0, 1)], null, false, params).quality).toBe(0.5);
    expect(resultScore([task(1, 4, 4, 1)], params)).toBe(60);
  });
});

describe('việc đột xuất (Nghị định 335/2025 Điều 18.1.d, ADR-046): tính ngoài số nhiệm vụ giao ban đầu, được tính thêm điểm', () => {
  const extra = (coefficient: number, planned: number, completed: number, qualityLevel: number | null, lateCount = 0, reworkCount = 0): ScoredTask => ({
    ...task(coefficient, planned, completed, qualityLevel, lateCount, reworkCount),
    extra: true,
  });

  it('không vào mẫu số: chỉ có việc đột xuất thì không tính được (mẫu số bằng 0)', () => {
    expect(kpiOf([extra(1, 5, 5, 1)], null, false)).toEqual({ quantity: 0, quality: 0, timeliness: 0, leadership: null, kpi: 0 });
  });

  it('việc thường đã đủ thì việc đột xuất không làm điểm vượt quá 100% mỗi thành phần', () => {
    const k = kpiOf([task(1, 10, 10, 1), extra(2, 5, 5, 1)], null, false);
    expect(k).toMatchObject({ quantity: 1, quality: 1, timeliness: 1, kpi: 1 });
    expect(resultScore([task(1, 10, 10, 1), extra(2, 5, 5, 1)])).toBe(70);
  });

  it('bù cho phần thiếu của việc thường: thường 6/10, đột xuất hệ số 2 làm xong 2 → (6 + 4) / 10 = 100%', () => {
    expect(kpiOf([task(1, 10, 6, 1)], null, false)).toMatchObject({ quantity: 0.6 });
    expect(kpiOf([task(1, 10, 6, 1), extra(2, 2, 2, 1)], null, false)).toMatchObject({ quantity: 1, quality: 1, timeliness: 1, kpi: 1 });
  });

  it('bù một phần: thường 6/10, đột xuất hệ số 1 làm xong 2 → (6 + 2) / 10 = 80%', () => {
    expect(kpiOf([task(1, 10, 6, 1), extra(1, 2, 2, 1)], null, false)).toMatchObject({ quantity: 0.8, quality: 0.8, timeliness: 0.8, kpi: 0.8 });
    expect(resultScore([task(1, 10, 6, 1), extra(1, 2, 2, 1)])).toBe(56);
  });

  it('việc đột xuất cũng bị trừ 25% mỗi lần chậm hoặc chưa đạt; chưa đánh giá chất lượng thì chưa có kết quả', () => {
    const k = kpiOf([task(1, 10, 6, 1), extra(1, 2, 2, 1, 1, 1)], null, false); // một lần chậm, một lần chưa đạt
    expect(k).toMatchObject({ quantity: 0.8, quality: 0.75, timeliness: 0.75 });
    expect(kpiOf([task(1, 10, 6, 1), extra(1, 2, 2, null)], null, false).quantity).toBe(0.6);
  });

  it('việc đột xuất chưa làm không kéo điểm xuống (không có trong mẫu số)', () => {
    expect(kpiOf([task(1, 10, 10, 1), extra(3, 4, 0, null)], null, false).kpi).toBe(1);
  });

  it('lãnh đạo: d, đ, e vẫn tính riêng, a, b, c có việc đột xuất', () => {
    const leadership: Leadership = { unitResult: 1, organizing: 1, solidarity: 1 };
    expect(kpiOf([task(1, 10, 5, 1), extra(1, 5, 5, 1)], leadership, true).kpi).toBe(1);
  });
});

describe('evaluate: điểm tổng và xếp loại', () => {
  it('cộng điểm chung và điểm kết quả, xếp loại theo ngưỡng', () => {
    const r = evaluate([task(1, 10, 10, 1), task(120 / 90, 3, 3, 2)], 25);
    expect(r).toMatchObject({ resultScore: 70, totalScore: 95, rating: 'XUAT_SAC', complete: true });
    expect(r.breakdown).toEqual({ quantity: 1, quality: 1, timeliness: 1, leadership: null, kpi: 1 });
  });

  it('đủ 90 điểm thì xuất sắc; làm một nửa còn 60 thì hoàn thành', () => {
    expect(evaluate([task(1, 10, 10, 1)], 20)).toMatchObject({ totalScore: 90, rating: 'XUAT_SAC' });
    expect(evaluate([task(1, 10, 5, 1)], 25)).toMatchObject({ totalScore: 60, rating: 'HOAN_THANH' });
  });

  it('chưa có điểm chung thì chưa có tổng và xếp loại', () => {
    expect(evaluate([task(1, 10, 10, 1)], null)).toMatchObject({ resultScore: 70, totalScore: null, rating: null });
  });

  it('báo chưa đầy đủ khi còn dòng có kết quả mà chưa có mức chất lượng', () => {
    expect(evaluate([task(1, 10, 10, null)], 20).complete).toBe(false);
    expect(evaluate([task(1, 10, 0, null)], 20).complete).toBe(true); // chưa làm gì thì không cần mức chất lượng
  });

  it('cán bộ lãnh đạo chưa được chấm D thì chưa đầy đủ', () => {
    const leadership: Leadership = { unitResult: 1, organizing: 1, solidarity: 1 };
    expect(evaluate([task(1, 10, 10, 1)], 20, DEFAULT_SCORING_PARAMS, null, true).complete).toBe(false);
    expect(evaluate([task(1, 10, 10, 1)], 20, DEFAULT_SCORING_PARAMS, leadership, true).complete).toBe(true);
  });

  it('từ chối điểm chung ngoài khoảng 0–30', () => {
    expect(() => evaluate([task(1, 10, 10, 1)], 31)).toThrow(RangeError);
    expect(() => evaluate([task(1, 10, 10, 1)], -1)).toThrow(RangeError);
  });
});

describe('buildPeriod', () => {
  it('tháng: nhãn và khoảng ngày, kể cả tháng 2 năm nhuận và năm thường', () => {
    expect(buildPeriod('MONTH', 2026, 9)).toMatchObject({ label: '2026-M09', startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(buildPeriod('MONTH', 2028, 2).endDate).toBe('2028-02-29');
    expect(buildPeriod('MONTH', 2026, 2).endDate).toBe('2026-02-28');
    expect(buildPeriod('MONTH', 2026, 12).endDate).toBe('2026-12-31');
  });

  it('quý I–III: khoảng ngày đúng', () => {
    expect(buildPeriod('QUARTER', 2026, 1)).toMatchObject({ label: '2026-Q1', startDate: '2026-01-01', endDate: '2026-03-31' });
    expect(buildPeriod('QUARTER', 2026, 2)).toMatchObject({ startDate: '2026-04-01', endDate: '2026-06-30' });
    expect(buildPeriod('QUARTER', 2026, 3)).toMatchObject({ startDate: '2026-07-01', endDate: '2026-09-30' });
  });

  it('quý IV bị từ chối vì gộp vào đánh giá năm', () => {
    expect(() => buildPeriod('QUARTER', 2026, 4)).toThrow(/quý IV/);
  });

  it('năm: không có số thứ tự', () => {
    expect(buildPeriod('YEAR', 2026)).toMatchObject({ label: '2026', number: null, startDate: '2026-01-01', endDate: '2026-12-31' });
    expect(() => buildPeriod('YEAR', 2026, 1)).toThrow(BadRequestException);
  });

  it('từ chối số thứ tự sai và năm vô lý', () => {
    expect(() => buildPeriod('MONTH', 2026, 13)).toThrow(BadRequestException);
    expect(() => buildPeriod('MONTH', 2026, 0)).toThrow(BadRequestException);
    expect(() => buildPeriod('MONTH', 2026)).toThrow(BadRequestException);
    expect(() => buildPeriod('QUARTER', 2026, 0)).toThrow(BadRequestException);
    expect(() => buildPeriod('YEAR', 1999)).toThrow(BadRequestException);
  });
});
