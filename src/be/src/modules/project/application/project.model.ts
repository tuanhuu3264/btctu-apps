/**
 * Đề án, dự án (yêu cầu bổ sung "đề án/dự án", ADR-050): một khung có mục tiêu, người chủ trì, thành viên, mốc tiến độ, tài liệu
 * và các việc được giao gắn vào. Điểm KPI vẫn tính từ việc như cũ; đề án chỉ nhóm và theo dõi, không có điểm riêng.
 */
export const PROJECT_KINDS = ['DE_AN', 'DU_AN'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

/**
 * DRAFT: đang soạn, chủ trì sửa tự do. SUBMITTED: đã trình, chờ duyệt. ACTIVE: đã duyệt, đang thực hiện.
 * COMPLETED: đã nghiệm thu. CANCELLED: đã hủy. Trả lại thì về DRAFT kèm lý do.
 */
export const PROJECT_STATUSES = ['DRAFT', 'SUBMITTED', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const MILESTONE_STATUSES = ['PENDING', 'DONE'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MEMBER_ROLES = ['LEAD', 'MEMBER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MAX_MEMBERS = 50;
export const MAX_MILESTONES = 100;
export const MAX_ATTACHMENTS = 30;
export const MAX_MILESTONE_WEIGHT = 100;

export interface ProjectModel {
  id: string;
  /** DA-2026-001 (đề án) hoặc DUA-2026-001 (dự án); duy nhất. */
  code: string;
  kind: ProjectKind;
  title: string;
  objective: string | null;
  description: string | null;
  /** Cán bộ chủ trì. */
  ownerPersonId: string;
  /** Đơn vị của vị trí chủ trì lúc lập (để thống kê theo phòng); null nếu chưa có vị trí. */
  unitId: string | null;
  /** YYYY-MM-DD */
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  createdByAccountId: string;
  submittedAt: Date | null;
  approvedByAccountId: string | null;
  approvedAt: Date | null;
  /** Lý do trả lại gần nhất (còn khi hồ sơ đã về DRAFT). */
  returnReason: string | null;
  /** Ngày nghiệm thu và nhận xét, hoặc lý do hủy. */
  completedOn: string | null;
  closeNote: string | null;
  createdAt: Date;
}
export type NewProject = Pick<ProjectModel, 'kind' | 'title' | 'objective' | 'description' | 'ownerPersonId' | 'unitId' | 'startDate' | 'endDate' | 'createdByAccountId'> & { code: string };
export type ProjectPatch = Partial<
  Pick<ProjectModel, 'title' | 'objective' | 'description' | 'ownerPersonId' | 'unitId' | 'startDate' | 'endDate' | 'status' | 'submittedAt' | 'approvedByAccountId' | 'approvedAt' | 'returnReason' | 'completedOn' | 'closeNote'>
>;

export interface MemberModel {
  projectId: string;
  personId: string;
  role: MemberRole;
}

export interface MilestoneModel {
  id: string;
  projectId: string;
  title: string;
  dueDate: string;
  /** Trọng số khi tính % tiến độ (số nguyên dương). */
  weight: number;
  /** Người phụ trách mốc, có thể trống (chủ trì phụ trách). */
  assigneePersonId: string | null;
  status: MilestoneStatus;
  completedOn: string | null;
  note: string | null;
  createdAt: Date;
}
export type NewMilestone = Pick<MilestoneModel, 'projectId' | 'title' | 'dueDate' | 'weight' | 'assigneePersonId' | 'note'>;
export type MilestonePatch = Partial<Pick<MilestoneModel, 'title' | 'dueDate' | 'weight' | 'assigneePersonId' | 'note' | 'status' | 'completedOn'>>;

export interface ProjectAttachmentModel {
  id: string;
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedByAccountId: string;
  createdAt: Date;
}
export type NewProjectAttachment = Omit<ProjectAttachmentModel, 'id' | 'createdAt'>;
