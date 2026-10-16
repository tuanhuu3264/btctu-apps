import type { Rating } from '../../scoring/index.js';
import type { PeriodWork } from './evaluation.ports.js';
import type { UnitMetrics } from './unit-evaluation.model.js';

/** Hạn mức xuất sắc: không vượt 20% số tổ chức hoàn thành tốt (Nghị định 335 Điều 8.5.a). */
export const EXCELLENT_QUOTA = 0.2;
/** Với tổ chức nổi trội cấp có thẩm quyền được quyết định tới 25% (Điều 8.5.b); hệ thống chỉ nêu trong cảnh báo. */
export const EXCELLENT_QUOTA_EXCEPTION = 0.25;
/** Chậm tiến độ tối đa của mức "hoàn thành" (Điều 8.3). */
export const MAX_LATE_SHARE = 0.2;
/** Tỷ lệ vượt mức tối thiểu của mức xuất sắc (Điều 8.1.a). */
export const MIN_EXCEEDED_SHARE = 0.3;
/** Dưới mức này là không hoàn thành (Điều 8.4.b). */
export const MIN_COMPLETED_SHARE = 0.7;

export function computeMetrics(works: readonly PeriodWork[]): UnitMetrics {
  const metrics: UnitMetrics = { works: works.length, completed: 0, onTime: 0, exceeded: 0, late: 0 };
  for (const w of works) {
    const done = w.confirmedQuantity >= w.plannedQuantity;
    if (done) metrics.completed++;
    if (done && w.lateCount === 0) metrics.onTime++;
    if (w.confirmedQuantity > w.plannedQuantity) metrics.exceeded++;
    if (w.lateCount > 0) metrics.late++;
  }
  return metrics;
}

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 1000) / 10}%`;
const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

/**
 * Điều kiện xếp loại của Điều 8 chưa đạt, đối chiếu với số liệu từ việc được giao. Chỉ cảnh báo: số liệu
 * này không bao quát mọi nhiệm vụ của tập thể nên người thẩm định, phê duyệt vẫn là người quyết định (ADR-030 mục 7).
 */
export function ratingWarnings(rating: Rating, metrics: UnitMetrics, belowUnfinished: readonly string[]): string[] {
  const out: string[] = [];
  const { works, completed, onTime, exceeded, late } = metrics;
  if (rating !== 'KHONG_HOAN_THANH') {
    if (works === 0) {
      out.push('Đơn vị chưa có việc được giao nào trong năm nên chưa đối chiếu được điều kiện xếp loại');
    } else if (share(completed, works) < MIN_COMPLETED_SHARE) {
      out.push(`Chỉ ${pct(completed, works)} việc hoàn thành đủ số lượng, dưới 70%: theo Điều 8.4.b là không hoàn thành nhiệm vụ`);
    }
  }
  if (works > 0) {
    if (rating === 'XUAT_SAC' || rating === 'HOAN_THANH_TOT') {
      if (onTime < works) out.push(`Chưa đủ 100% nhiệm vụ hoàn thành đúng hạn (${onTime}/${works} việc, ${pct(onTime, works)})`);
    }
    if (rating === 'XUAT_SAC' && share(exceeded, works) < MIN_EXCEEDED_SHARE) {
      out.push(`Mức xuất sắc cần ít nhất 30% nhiệm vụ vượt mức, hiện ${exceeded}/${works} việc (${pct(exceeded, works)})`);
    }
    if (rating === 'HOAN_THANH') {
      if (completed < works) out.push(`Chưa đủ 100% nhiệm vụ được giao hoàn thành (${completed}/${works} việc)`);
      if (share(late, works) > MAX_LATE_SHARE) out.push(`Việc chậm tiến độ chiếm ${pct(late, works)}, vượt 20%`);
    }
  }
  if (rating === 'XUAT_SAC') {
    if (belowUnfinished.length > 0) out.push(`Có đơn vị cấp dưới xếp loại không hoàn thành nhiệm vụ: ${belowUnfinished.join(', ')}`);
    out.push('Cần người thẩm định xác nhận đã khắc phục hạn chế, khuyết điểm của kỳ trước (hệ thống không kiểm tra được)');
  }
  return out;
}

const RANK: Record<Rating, number> = { KHONG_HOAN_THANH: 0, HOAN_THANH: 1, HOAN_THANH_TOT: 2, XUAT_SAC: 3 };
const LABEL: Record<Rating, string> = {
  XUAT_SAC: 'hoàn thành xuất sắc nhiệm vụ',
  HOAN_THANH_TOT: 'hoàn thành tốt nhiệm vụ',
  HOAN_THANH: 'hoàn thành nhiệm vụ',
  KHONG_HOAN_THANH: 'không hoàn thành nhiệm vụ',
};

/**
 * Mức xếp loại của người đứng đầu không cao hơn mức của tổ chức (Nghị định 335 Điều 20.6).
 * `approved` false nghĩa là mức của đơn vị mới là đề xuất hoặc chưa được công nhận.
 */
export function headRatingWarning(headRating: Rating, unit: { unitName: string; rating: Rating; approved: boolean }): string | null {
  if (RANK[headRating] <= RANK[unit.rating]) return null;
  const state = unit.approved ? '' : ' (mới đề xuất, chưa được công nhận)';
  return `Người đứng đầu đang ở mức ${LABEL[headRating]}, cao hơn mức của ${unit.unitName}: ${LABEL[unit.rating]}${state}. Theo Nghị định 335 Điều 20.6, mức của người đứng đầu không cao hơn mức của tổ chức.`;
}

/** Cảnh báo khi số đơn vị xuất sắc vượt hạn mức so với số đơn vị hoàn thành tốt trong cùng kỳ. */
export function quotaWarning(ratings: readonly Rating[]): string | null {
  const excellent = ratings.filter((r) => r === 'XUAT_SAC').length;
  const good = ratings.filter((r) => r === 'HOAN_THANH_TOT').length;
  if (excellent === 0 || excellent <= good * EXCELLENT_QUOTA) return null;
  return `Có ${excellent} đơn vị xuất sắc trên ${good} đơn vị hoàn thành tốt, vượt hạn mức 20% (cấp có thẩm quyền được quyết định tới 25% với đơn vị nổi trội; ngoại lệ khi có ít đối tượng chưa được tính)`;
}
