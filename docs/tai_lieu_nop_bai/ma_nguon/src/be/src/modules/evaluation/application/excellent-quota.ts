import type { Rating } from '../../scoring/index.js';

/**
 * Hạn mức xếp loại "Hoàn thành xuất sắc nhiệm vụ" của cá nhân trong một nhóm (ADR-060). Căn cứ: Nghị định 335 Điều 8.5; 39-QĐ/TU
 * Điều 11; tham khảo cách làm của Quy định 143-QĐ/TU Khánh Hòa Điều 2.6 (nhiều người từ 90 điểm thì lấy từ cao xuống thấp; đơn vị từ
 * 5 người trở xuống được chọn 1 người). Chỉ là gợi ý để người phê duyệt quyết định, hệ thống không tự hạ bậc.
 */
export const EXCELLENT_RATIO = 0.2;
/** Đơn vị có thành tích nổi trội: cấp có thẩm quyền được quyết định tới mức này. */
export const EXCELLENT_RATIO_EXCEPTIONAL = 0.25;
/** Nhóm có từ chừng này người trở xuống thì được chọn 1 người xuất sắc nếu đủ điều kiện. */
export const SMALL_GROUP_SIZE = 5;

export interface QuotaRow {
  evaluationId: string;
  personId: string;
  score: number;
  rating: Rating;
}

export interface QuotaRanked extends QuotaRow {
  /** Thứ hạng theo điểm giảm dần trong số đang được đề xuất xuất sắc (1 là cao nhất). */
  rank: number;
  /** Nằm trong hạn mức theo thứ tự điểm; false là vượt hạn mức. */
  within: boolean;
  /** Điểm bằng điểm người ở ranh giới hạn mức: cần cấp có thẩm quyền xem xét tổng thể. */
  tie: boolean;
}

export interface ExcellentQuota {
  /** Số người trong nhóm đã có mức xếp loại. */
  groupSize: number;
  /** Số người đang ở mức xuất sắc và hoàn thành tốt. */
  excellent: number;
  good: number;
  /** Số người xuất sắc tối đa theo mức 20% (tính cả việc hạ người vượt xuống "hoàn thành tốt" thì cơ sở tăng). */
  allowed: number;
  /** Mức tối đa khi cấp có thẩm quyền áp dụng 25% cho đơn vị nổi trội. */
  allowedExceptional: number;
  /** Nhóm nhỏ: được chọn 1 người dù tỉ lệ cho 0. */
  smallGroup: boolean;
  exceeded: boolean;
  ranking: QuotaRanked[];
}

/** Số người xuất sắc lớn nhất k (k <= excellent) mà k <= floor(ratio × (good + excellent − k)): người vượt hạn mức hạ xuống "tốt" làm cơ sở tăng. */
function maxExcellent(good: number, excellent: number, ratio: number, floorOne: boolean): number {
  let best = 0;
  for (let k = 0; k <= excellent; k += 1) {
    if (k <= Math.floor(ratio * (good + excellent - k) + 1e-9)) best = k;
  }
  return floorOne ? Math.max(best, Math.min(1, excellent)) : best;
}

/** `groupSize`: số người của nhóm trong kỳ (kể cả chưa có mức xếp loại), dùng cho quy tắc nhóm từ 5 người trở xuống; mặc định là số người đã có mức. */
export function excellentQuota(rows: readonly QuotaRow[], groupSize: number = rows.length): ExcellentQuota {
  const excellentRows = rows.filter((r) => r.rating === 'XUAT_SAC');
  const good = rows.filter((r) => r.rating === 'HOAN_THANH_TOT').length;
  const excellent = excellentRows.length;
  const smallGroup = groupSize <= SMALL_GROUP_SIZE;
  const allowed = maxExcellent(good, excellent, EXCELLENT_RATIO, smallGroup);
  const allowedExceptional = maxExcellent(good, excellent, EXCELLENT_RATIO_EXCEPTIONAL, smallGroup);

  const sorted = [...excellentRows].sort((a, b) => b.score - a.score || a.evaluationId.localeCompare(b.evaluationId));
  const boundary = allowed > 0 && allowed < sorted.length ? sorted[allowed - 1].score : null;
  const ranking: QuotaRanked[] = sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    within: i < allowed,
    // Hòa điểm ở ranh giới: người trong và người ngoài hạn mức có cùng điểm thì không phân biệt được bằng điểm.
    tie: boundary !== null && r.score === boundary && sorted.some((o, j) => (j < allowed) !== (i < allowed) && o.score === boundary),
  }));
  return { groupSize, excellent, good, allowed, allowedExceptional, smallGroup, exceeded: excellent > allowed, ranking };
}

/** Khóa nhóm "nhiệm vụ tương đồng" (giả định của dự án, GAP G-40): cùng đơn vị và cùng loại vị trí (lãnh đạo, hỗ trợ, phục vụ, còn lại). */
export function quotaGroupKey(position: { unitId?: string; isLeader?: boolean; isSupport?: boolean }): string {
  return `${position.unitId ?? '-'}|${position.isLeader ? 'LEADER' : position.isSupport ? 'SUPPORT' : 'STAFF'}`;
}

/** Câu nhắc cho người phê duyệt một hồ sơ đề xuất xuất sắc; null nếu trong hạn mức. */
export function quotaMessage(q: ExcellentQuota, mine: QuotaRanked | undefined): string | null {
  if (!mine || !q.exceeded) return null;
  const share = `${q.excellent} người xuất sắc trên ${q.good} người hoàn thành tốt, nhóm ${q.groupSize} người`;
  const rank = `Hồ sơ này đứng thứ ${mine.rank}/${q.excellent} theo điểm trong số đề xuất xuất sắc`;
  const outcome = mine.within
    ? 'nằm trong hạn mức'
    : mine.tie
      ? 'bằng điểm người ở ranh giới hạn mức, cấp có thẩm quyền cần xem xét tổng thể'
      : 'nằm ngoài hạn mức theo thứ tự điểm';
  const small = q.smallGroup ? ' Nhóm từ 5 người trở xuống được chọn 1 người.' : '';
  return `Vượt hạn mức xuất sắc: ${share}; tối đa ${q.allowed} người (20%), tới ${q.allowedExceptional} người nếu cấp có thẩm quyền áp dụng 25% cho đơn vị nổi trội.${small} ${rank}: ${outcome}. Hệ thống chỉ gợi ý, không tự hạ bậc (Nghị định 335 Điều 8.5).`;
}
