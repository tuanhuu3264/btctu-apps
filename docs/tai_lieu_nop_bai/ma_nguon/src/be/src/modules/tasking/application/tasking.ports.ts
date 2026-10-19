import type {
  AssignmentModel,
  AssignmentPatch,
  AssignmentStatus,
  AttachmentModel,
  CommentModel,
  NewAssignment,
  NewAttachment,
  NewComment,
  NewProgress,
  NewWaiver,
  NewWorkTask,
  ProgressModel,
  ProgressPatch,
  WaiverModel,
  WorkTaskModel,
} from './tasking.model.js';
import type { ParsedOkr } from '../../organization/index.js';
import type { NewRecurringTemplate, RecurringTemplateModel, RecurringTemplatePatch } from './recurring.model.js';

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
  /** Sửa nội dung, người duyệt, kết quả then chốt; khi duyệt đề xuất còn mức độ khó, số lượng, hạn. */
  abstract update(id: string, patch: AssignmentPatch): Promise<AssignmentModel>;
  /** Việc gắn vào một đề án, dự án (ADR-050). */
  abstract findByProject(projectId: string): Promise<AssignmentModel[]>;
  /** Các ngày lặp đã sinh việc của một mẫu (kể cả việc đã hủy), để không sinh trùng. */
  abstract findRecurringKeys(templateId: string): Promise<Set<string>>;
  /** Việc do một mẫu việc lặp sinh ra. */
  abstract findByTemplate(templateId: string): Promise<AssignmentModel[]>;
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

export abstract class WaiverRepository {
  /** Mọi miễn trừ (kể cả đã thu hồi) của các lần báo cáo đã cho. */
  abstract findByProgress(progressIds: readonly string[]): Promise<WaiverModel[]>;
  abstract create(data: NewWaiver): Promise<WaiverModel>;
  abstract revoke(id: string, by: string, at: Date, note: string): Promise<WaiverModel>;
}

/** Cổng sang mô-đun organization: ai là cấp trên, ai là cấp dưới của một cán bộ tại thời điểm này. */
export abstract class OrgDirectory {
  /** Người giữ các vị trí cấp trên, từ trực tiếp lên gốc, đã bỏ vị trí trống. */
  abstract superiorHolders(personId: string, positionId?: string | null): Promise<string[]>;
  /** Người giữ các vị trí cấp dưới (trực tiếp hoặc mọi cấp). */
  abstract subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]>;
  /** Trong các mã cán bộ đã cho, những người đang được quản lý (chưa ngừng). */
  abstract activePersonIds(personIds: readonly string[]): Promise<Set<string>>;
  /** Đơn vị và vị trí `positionId` (hoặc vị trí chính nếu không nêu) của cán bộ, hoặc null nếu chưa có vị trí. */
  abstract placementOf(personId: string, positionId?: string | null): Promise<Placement | null>;
  /** Mọi vị trí cán bộ đang giữ, vị trí chính trước, rồi kiêm nhiệm (ADR-047). */
  abstract placementsOf(personId: string): Promise<(Placement & { kind: 'PRIMARY' | 'CONCURRENT' })[]>;
  /** Mục tiêu và kết quả then chốt của vị trí cán bộ đang giữ (ADR-034), hoặc null. */
  abstract okrOf(personId: string): Promise<ParsedOkr | null>;
  /** Tên cán bộ, chức danh và đơn vị của vị trí, để ghép vào tệp xuất và thống kê. */
  abstract lookup(): Promise<{ persons: Map<string, { fullName: string }>; positions: Map<string, { title: string; unitName: string }> }>;
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

/** Mẫu việc lặp (ADR-046). */
export abstract class RecurringTemplateRepository {
  abstract findById(id: string): Promise<RecurringTemplateModel | null>;
  abstract findAll(): Promise<RecurringTemplateModel[]>;
  abstract findActive(): Promise<RecurringTemplateModel[]>;
  abstract create(data: NewRecurringTemplate): Promise<RecurringTemplateModel>;
  abstract update(id: string, patch: RecurringTemplatePatch): Promise<RecurringTemplateModel>;
}
