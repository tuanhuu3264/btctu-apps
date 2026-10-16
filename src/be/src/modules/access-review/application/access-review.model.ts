export type ReviewStatus = 'OPEN' | 'CLOSED';
export const REVIEW_DECISIONS = ['KEEP', 'REVOKE'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * Ai xác nhận mục rà soát: LEADER là lãnh đạo phòng (hoặc cấp trên của lãnh đạo phòng); DATA_ADMIN là quản trị dữ liệu
 * khi tài khoản không gắn cán bộ hoặc không tìm được lãnh đạo (ADR-044).
 */
export type ReviewerKind = 'LEADER' | 'DATA_ADMIN';

/** Đợt rà soát quyền theo quý. */
export interface AccessReviewModel {
  id: string;
  year: number;
  quarter: number;
  label: string;
  status: ReviewStatus;
  /** Hạn xác nhận, dạng YYYY-MM-DD theo giờ Việt Nam. */
  dueDate: string;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  closedBy: string | null;
  closedAt: Date | null;
}
export type NewAccessReview = Pick<AccessReviewModel, 'year' | 'quarter' | 'label' | 'dueDate' | 'note' | 'createdBy' | 'createdAt'>;

/** Một vai trò của một tài khoản tại thời điểm tạo đợt; mọi trường mô tả là ảnh chụp, không đổi về sau. */
export interface AccessReviewItemModel {
  id: string;
  reviewId: string;
  accountId: string;
  username: string;
  personId: string | null;
  personName: string | null;
  unitName: string | null;
  positionTitle: string | null;
  role: string;
  roleAssignmentId: string;
  roleValidFrom: Date;
  roleValidTo: Date | null;
  reviewerKind: ReviewerKind;
  reviewerPersonId: string | null;
  reviewerName: string | null;
  decision: ReviewDecision | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  /** REVOKE đã được thực hiện (vai trò đã thu hồi thật). */
  revokeApplied: boolean;
}
export type NewAccessReviewItem = Omit<AccessReviewItemModel, 'id' | 'reviewId' | 'decision' | 'decidedBy' | 'decidedAt' | 'note' | 'revokeApplied'>;
export type ItemDecisionPatch = Pick<AccessReviewItemModel, 'decision' | 'decidedBy' | 'decidedAt' | 'note' | 'revokeApplied'>;

export interface ReviewCounts {
  total: number;
  decided: number;
  pending: number;
  keep: number;
  revoke: number;
}

export interface AccessReviewView extends AccessReviewModel {
  counts: ReviewCounts;
  overdue: boolean;
}

export interface AccessReviewDetail {
  review: AccessReviewView;
  items: (AccessReviewItemModel & { canDecide: boolean })[];
}

export function countsOf(items: readonly Pick<AccessReviewItemModel, 'decision'>[]): ReviewCounts {
  const keep = items.filter((i) => i.decision === 'KEEP').length;
  const revoke = items.filter((i) => i.decision === 'REVOKE').length;
  return { total: items.length, decided: keep + revoke, pending: items.length - keep - revoke, keep, revoke };
}

/** Quý của một thời điểm, theo giờ Việt Nam. */
export function quarterOf(at: Date): { year: number; quarter: number } {
  const vn = new Date(at.getTime() + 7 * 3_600_000);
  return { year: vn.getUTCFullYear(), quarter: Math.floor(vn.getUTCMonth() / 3) + 1 };
}

/** Ngày theo giờ Việt Nam dạng YYYY-MM-DD. */
export function dateOf(at: Date): string {
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}
