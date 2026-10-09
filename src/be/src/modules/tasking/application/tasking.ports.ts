import type {
  AssignmentModel,
  AssignmentStatus,
  AttachmentModel,
  CommentModel,
  NewAssignment,
  NewAttachment,
  NewComment,
  NewProgress,
  NewWorkTask,
  ProgressModel,
  ProgressPatch,
  WorkTaskModel,
} from './tasking.model.js';

/** Các cổng của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class AssignmentRepository {
  abstract findById(id: string): Promise<AssignmentModel | null>;
  abstract findByAssignees(personIds: readonly string[]): Promise<AssignmentModel[]>;
  abstract findAll(): Promise<AssignmentModel[]>;
  abstract findByIds(ids: readonly string[]): Promise<AssignmentModel[]>;
  /** Việc do tài khoản này giao. */
  abstract findByAssigner(accountId: string): Promise<AssignmentModel[]>;
  /** Việc chỉ định người này làm người duyệt (cc). */
  abstract findByApprover(personId: string): Promise<AssignmentModel[]>;
  /** Sửa nội dung và người duyệt. */
  abstract update(id: string, patch: { note?: string | null; approverPersonId?: string | null }): Promise<AssignmentModel>;
  /** Việc đang mở có hạn trong khoảng ngày [from, to]. */
  abstract findOpenDueBetween(from: string, to: string): Promise<AssignmentModel[]>;
  abstract create(data: NewAssignment): Promise<AssignmentModel>;
  abstract setStatus(id: string, status: AssignmentStatus): Promise<AssignmentModel>;
}

/** Người tham vấn của việc (ADR-024). */
export abstract class ConsultantRepository {
  abstract findByAssignments(assignmentIds: readonly string[]): Promise<{ assignmentId: string; personId: string }[]>;
  abstract findAssignmentIds(personId: string): Promise<string[]>;
  /** Thay toàn bộ danh sách người tham vấn của một việc. */
  abstract replace(assignmentId: string, personIds: readonly string[]): Promise<void>;
}

export abstract class CommentRepository {
  abstract findByAssignment(assignmentId: string): Promise<CommentModel[]>;
  abstract findById(id: string): Promise<CommentModel | null>;
  abstract create(data: NewComment): Promise<CommentModel>;
}

export abstract class AttachmentRepository {
  abstract findByAssignment(assignmentId: string): Promise<AttachmentModel[]>;
  abstract findByAssignments(assignmentIds: readonly string[]): Promise<AttachmentModel[]>;
  abstract findById(id: string): Promise<AttachmentModel | null>;
  abstract create(data: NewAttachment): Promise<AttachmentModel>;
}

/** Kho tệp tương thích S3: MinIO khi phát triển, Cloudflare R2 về sau (ADR-024). */
export abstract class FileStorage {
  abstract put(key: string, data: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
}

export abstract class WorkTaskRepository {
  abstract findById(id: string): Promise<WorkTaskModel | null>;
  abstract findByIds(ids: readonly string[]): Promise<WorkTaskModel[]>;
  abstract findByAssignees(personIds: readonly string[]): Promise<WorkTaskModel[]>;
  abstract findAll(): Promise<WorkTaskModel[]>;
  /** Nhiệm vụ cùng tên (không phân biệt hoa thường) của cán bộ, hoặc null. */
  abstract findByAssigneeAndTitle(personId: string, title: string): Promise<WorkTaskModel | null>;
  abstract create(data: NewWorkTask): Promise<WorkTaskModel>;
}

export abstract class ProgressRepository {
  abstract findById(id: string): Promise<ProgressModel | null>;
  abstract findByAssignments(assignmentIds: readonly string[]): Promise<ProgressModel[]>;
  abstract create(data: NewProgress): Promise<ProgressModel>;
  abstract update(id: string, patch: ProgressPatch): Promise<ProgressModel>;
}

/** Cổng sang mô-đun organization: ai là cấp trên, ai là cấp dưới của một cán bộ tại thời điểm này. */
export abstract class OrgDirectory {
  /** Người giữ các vị trí cấp trên, từ trực tiếp lên gốc, đã bỏ vị trí trống. */
  abstract superiorHolders(personId: string): Promise<string[]>;
  /** Người giữ các vị trí cấp dưới (trực tiếp hoặc mọi cấp). */
  abstract subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]>;
  /** Trong các mã cán bộ đã cho, những người đang được quản lý (chưa ngừng). */
  abstract activePersonIds(personIds: readonly string[]): Promise<Set<string>>;
  /** Đơn vị và vị trí cán bộ đang giữ, hoặc null nếu chưa có vị trí. */
  abstract placementOf(personId: string): Promise<Placement | null>;
}

/** Nơi cán bộ đang công tác, dùng để đối chiếu phạm vi áp dụng của công việc (ADR-021). */
export interface Placement {
  unitId: string;
  positionId: string;
}

export interface CatalogItemInfo {
  name: string;
  coefficient: number | null;
  /** Phạm vi áp dụng (ADR-021); thiếu hoặc rỗng cả hai là việc chung. */
  unitIds?: string[];
  positionIds?: string[];
}

/** Cổng sang mô-đun catalog. */
export abstract class CatalogDirectory {
  /** Phiên bản đang hiệu lực kèm các công việc, hoặc null nếu chưa có phiên bản nào được phê duyệt. */
  abstract currentApproved(): Promise<{ versionId: string; items: Map<string, CatalogItemInfo> } | null>;
  /** Thông tin công việc theo phiên bản (dùng để hiện tên cho việc đã giao). */
  abstract itemsOf(versionId: string): Promise<Map<string, CatalogItemInfo> | null>;
}
