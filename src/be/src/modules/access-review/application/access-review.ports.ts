import type {
  AccessReviewItemModel,
  AccessReviewModel,
  ItemDecisionPatch,
  NewAccessReview,
  NewAccessReviewItem,
} from './access-review.model.js';

export abstract class AccessReviewRepository {
  /** Tạo đợt cùng các mục trong một giao dịch. */
  abstract create(review: NewAccessReview, items: readonly NewAccessReviewItem[]): Promise<AccessReviewModel>;
  abstract findById(id: string): Promise<AccessReviewModel | null>;
  abstract findByQuarter(year: number, quarter: number): Promise<AccessReviewModel | null>;
  /** Mới nhất trước. */
  abstract findAll(): Promise<AccessReviewModel[]>;
  abstract items(reviewId: string): Promise<AccessReviewItemModel[]>;
  abstract findItem(itemId: string): Promise<AccessReviewItemModel | null>;
  abstract decideItem(itemId: string, patch: ItemDecisionPatch): Promise<AccessReviewItemModel>;
  abstract close(id: string, closedBy: string, at: Date): Promise<AccessReviewModel>;
}

export interface LiveRole {
  accountId: string;
  username: string;
  personId: string | null;
  role: string;
  roleAssignmentId: string;
  validFrom: Date;
  validTo: Date | null;
}

/** Cổng sang mô-đun security: các vai trò đang có hiệu lực và việc thu hồi thật. */
export abstract class RoleSource {
  abstract liveRoles(): Promise<LiveRole[]>;
  /** Thu hồi một gán vai trò (đã thu hồi rồi thì bỏ qua). */
  abstract revoke(accountId: string, roleAssignmentId: string): Promise<void>;
}

export interface PersonPlacement {
  personName: string;
  unitName: string | null;
  positionTitle: string | null;
  /** Lãnh đạo xác nhận: người đứng đầu đơn vị; nếu chính họ là người đứng đầu thì cấp trên trực tiếp có người giữ. null: không có. */
  reviewerPersonId: string | null;
  reviewerName: string | null;
}

/** Cổng sang mô-đun organization. Cán bộ không có vị trí thì vẫn có mục `personName`, các trường còn lại null. */
export abstract class ReviewOrgDirectory {
  abstract placements(personIds: readonly string[]): Promise<Map<string, PersonPlacement>>;
}

/** Cổng xuất kết quả một đợt ra tệp Excel làm hồ sơ kiểm toán. */
export abstract class ReviewExporter {
  abstract renderExcel(review: AccessReviewModel, items: readonly AccessReviewItemModel[]): Promise<Buffer>;
}
