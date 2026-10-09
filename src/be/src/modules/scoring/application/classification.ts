/**
 * Xếp loại theo điểm, thang 100 (Quy định 39-QĐ/TU Điều 11, Hướng dẫn 05-HD/TU mục IV).
 *
 * Chỉ là bước (a) của ADR-002. Chưa làm: điều kiện kèm theo, trường hợp loại trừ xuống
 * "không hoàn thành" và hạn mức xuất sắc theo nhóm (bước b, c).
 */
export type Rating = 'XUAT_SAC' | 'HOAN_THANH_TOT' | 'HOAN_THANH' | 'KHONG_HOAN_THANH';

export interface Thresholds {
  /** Từ mức này trở lên: hoàn thành xuất sắc. */
  excellent: number;
  /** Từ mức này đến dưới excellent: hoàn thành tốt. */
  good: number;
  /** Từ mức này đến dưới good: hoàn thành. Dưới mức này: không hoàn thành. */
  fair: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { excellent: 90, good: 70, fair: 50 };

export const MAX_GENERAL_SCORE = 30;
export const MAX_RESULT_SCORE = 70;

export function totalScore(general: number, result: number): number {
  if (!(general >= 0 && general <= MAX_GENERAL_SCORE)) {
    throw new RangeError(`Điểm tiêu chí chung phải trong khoảng 0..${MAX_GENERAL_SCORE}: ${general}`);
  }
  if (!(result >= 0 && result <= MAX_RESULT_SCORE)) {
    throw new RangeError(`Điểm kết quả nhiệm vụ phải trong khoảng 0..${MAX_RESULT_SCORE}: ${result}`);
  }
  return general + result;
}

export function classifyByScore(score: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Rating {
  if (!(score >= 0 && score <= 100)) {
    throw new RangeError(`Điểm phải trong khoảng 0..100: ${score}`);
  }
  if (score >= thresholds.excellent) return 'XUAT_SAC';
  if (score >= thresholds.good) return 'HOAN_THANH_TOT';
  if (score >= thresholds.fair) return 'HOAN_THANH';
  return 'KHONG_HOAN_THANH';
}
