import { classifyByScore } from '../../scoring/index.js';
import type { Rating } from '../../scoring/index.js';

/** Từ 6 tháng (đã phê duyệt hoặc nghỉ có căn cứ) mới xếp loại năm (Nghị định 335 Điều 11.1, 11.2). */
export const MIN_MONTHS_FOR_YEAR = 6;

/** Điểm của một tháng đã phê duyệt dùng để lấy trung bình. */
export interface MonthScore {
  /** Tháng từ 1 đến 12. */
  month: number;
  label: string;
  generalScore: number;
  resultScore: number;
  totalScore: number;
}

/** Điểm trung bình của một quý hoặc 6 tháng, chỉ để theo dõi (Điều 17.3, ADR-039 mục 9). */
export interface PeriodAverage {
  key: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1';
  label: string;
  /** Các tháng thuộc khoảng này. */
  span: number[];
  /** Số tháng có hồ sơ đã phê duyệt. */
  approved: number;
  /** Tháng chưa có hồ sơ đã phê duyệt và không nghỉ. */
  missing: number[];
  /** Tháng nghỉ có căn cứ. */
  exempt: number[];
  totalScore: number | null;
  rating: Rating | null;
  /** Đủ mọi tháng (đã phê duyệt hoặc nghỉ) trong khoảng. */
  complete: boolean;
}

export interface YearAverage {
  months: MonthScore[];
  /** Tháng chưa có hồ sơ đã phê duyệt và không nghỉ. */
  missing: number[];
  /** Tháng nghỉ có căn cứ (Điều 11.2): không tính vào trung bình, không cảnh báo thiếu. */
  exempt: number[];
  /** Đủ số tháng tối thiểu để xếp loại. */
  enough: boolean;
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: Rating | null;
  /** Quý I đến IV và 6 tháng đầu năm. */
  periods: PeriodAverage[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (values: number[]) => round2(values.reduce((a, b) => a + b, 0) / values.length);
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const SPANS: { key: PeriodAverage['key']; label: string; span: number[] }[] = [
  { key: 'Q1', label: 'Quý I', span: range(1, 3) },
  { key: 'Q2', label: 'Quý II', span: range(4, 6) },
  { key: 'Q3', label: 'Quý III', span: range(7, 9) },
  { key: 'Q4', label: 'Quý IV (gộp vào năm)', span: range(10, 12) },
  { key: 'H1', label: '6 tháng đầu năm', span: range(1, 6) },
];

/**
 * Điểm năm bằng trung bình cộng điểm các tháng đã phê duyệt (Nghị định 335 Điều 17.3). Tháng nghỉ có căn cứ (Điều 11.2)
 * không tính vào trung bình và không bị coi là thiếu; tháng khác chưa có hồ sơ được nêu để người thẩm định xử lý.
 * Điều kiện xếp loại: tháng đã phê duyệt cộng tháng nghỉ đạt ngưỡng tối thiểu (Điều 11.1) và có ít nhất một tháng đã phê duyệt.
 * Tổng điểm lấy bằng điểm chung trung bình cộng điểm kết quả trung bình (cùng bằng trung bình các tổng).
 */
export function averageYear(months: readonly MonthScore[], exemptMonths: readonly number[] = []): YearAverage {
  const sorted = [...months].sort((a, b) => a.month - b.month);
  const present = new Set(sorted.map((m) => m.month));
  // Tháng đã có hồ sơ phê duyệt thì tính điểm, không coi là tháng nghỉ.
  const exempt = [...new Set(exemptMonths)].filter((m) => m >= 1 && m <= 12 && !present.has(m)).sort((a, b) => a - b);
  const skipped = new Set(exempt);
  const missing = range(1, 12).filter((m) => !present.has(m) && !skipped.has(m));
  const enough = sorted.length >= 1 && sorted.length + exempt.length >= MIN_MONTHS_FOR_YEAR;
  const periods = SPANS.map((s) => averagePeriod(s, sorted, skipped));
  if (sorted.length === 0) return { months: sorted, missing, exempt, enough, generalScore: null, resultScore: null, totalScore: null, rating: null, periods };

  const generalScore = mean(sorted.map((m) => m.generalScore));
  const resultScore = mean(sorted.map((m) => m.resultScore));
  const totalScore = round2(generalScore + resultScore);
  return { months: sorted, missing, exempt, enough, generalScore, resultScore, totalScore, rating: enough ? classifyByScore(totalScore) : null, periods };
}

function averagePeriod(spec: (typeof SPANS)[number], scores: readonly MonthScore[], exempt: ReadonlySet<number>): PeriodAverage {
  const inSpan = scores.filter((m) => spec.span.includes(m.month));
  const present = new Set(inSpan.map((m) => m.month));
  const exemptIn = spec.span.filter((m) => exempt.has(m));
  const missing = spec.span.filter((m) => !present.has(m) && !exempt.has(m));
  const totalScore = inSpan.length === 0 ? null : mean(inSpan.map((m) => m.totalScore));
  return {
    key: spec.key,
    label: spec.label,
    span: spec.span,
    approved: inSpan.length,
    missing,
    exempt: exemptIn,
    totalScore,
    rating: totalScore === null ? null : classifyByScore(totalScore),
    complete: missing.length === 0,
  };
}
