/** Loại báo cáo (kỳ) mà một việc được tính vào. */
export const REPORT_KINDS = ['MONTH', 'QUARTER', 'YEAR'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** AUTO: máy tự đưa vào mọi kỳ chứa hạn của việc. MANUAL: người giao chọn loại báo cáo (ADR-016 mục 4). */
export type PeriodMode = 'AUTO' | 'MANUAL';
/** PROPOSED: cán bộ đề xuất việc đột xuất, chờ cấp trên duyệt; chưa tính vào hồ sơ kỳ (ADR-046). */
export type AssignmentStatus = 'PROPOSED' | 'OPEN' | 'CANCELLED';
/** CATALOG: việc lấy từ danh mục sản phẩm công việc chuẩn. AD_HOC: việc đột xuất, phát sinh ngoài kế hoạch (ADR-046). */
export type AssignmentSource = 'CATALOG' | 'AD_HOC';
export type ProgressStatus = 'REPORTED' | 'CONFIRMED' | 'REJECTED';

export const MAX_QUANTITY = 100_000;

/** Việc được giao cho một cán bộ, lấy từ danh mục sản phẩm công việc chuẩn. */
export interface AssignmentModel {
  id: string;
  /** Nhiệm vụ chứa công việc này (ADR-018). */
  taskId: string;
  assigneePersonId: string;
  assignerAccountId: string | null;
  catalogItemCode: string;
  /** Phiên bản danh mục đang hiệu lực lúc giao, để tra tên và hệ số về sau. */
  catalogVersionId: string;
  plannedQuantity: number;
  /** Hạn hoàn thành, dạng YYYY-MM-DD. Hạn quyết định việc thuộc kỳ nào (ADR-016 mục 4). */
  dueDate: string;
  periodMode: PeriodMode;
  /** Với AUTO luôn là cả ba loại; với MANUAL là các loại người giao đã chọn. */
  reportKinds: ReportKind[];
  /** Nội dung việc (ADR-024; trước đây gọi là ghi chú). */
  note: string | null;
  status: AssignmentStatus;
  /** Người duyệt (cc) do người giao chọn, là một cấp trên của người nhận. null: cấp trên trực tiếp (ADR-024). */
  approverPersonId: string | null;
  /** Kết quả then chốt (OKR) của người nhận mà việc này góp phần đạt, ví dụ "KR2: Đôn đốc phòng ≥95% nhiệm vụ". Chỉ để theo dõi, không tính điểm (ADR-034). */
  okrKeyResult: string | null;
  /** Ngày giao. */
  createdAt: Date;
  source: AssignmentSource;
  /** Tên việc đột xuất; null với việc từ danh mục. */
  title: string | null;
  /** Mẫu việc lặp đã sinh ra việc này, và ngày của lần lặp (cặp này duy nhất); null nếu giao tay. */
  recurringTemplateId: string | null;
  recurringKey: string | null;
  /** Vị trí mà việc được giao cho, để việc chỉ tính vào phiếu của vị trí đó khi người nhận kiêm nhiệm (ADR-047). null: chưa xác định, hiểu là vị trí chính. */
  positionId: string | null;
  /** Đề án, dự án mà việc này góp phần (ADR-050); null nếu không thuộc đề án nào. */
  projectId: string | null;
}
export type NewAssignment = Omit<
  AssignmentModel,
  'id' | 'status' | 'createdAt' | 'approverPersonId' | 'okrKeyResult' | 'source' | 'title' | 'recurringTemplateId' | 'recurringKey' | 'positionId' | 'projectId'
> & {
  positionId?: string | null;
  projectId?: string | null;
  approverPersonId?: string | null;
  okrKeyResult?: string | null;
  source?: AssignmentSource;
  title?: string | null;
  recurringTemplateId?: string | null;
  recurringKey?: string | null;
  /** Mặc định OPEN; PROPOSED khi cán bộ đề xuất việc đột xuất. */
  status?: 'OPEN' | 'PROPOSED';
};

/** Phần được sửa của một việc: nội dung, người duyệt, kết quả then chốt; khi duyệt đề xuất còn mức độ khó (mã ảo), số lượng và hạn. */
export type AssignmentPatch = Partial<Pick<AssignmentModel, 'note' | 'approverPersonId' | 'okrKeyResult' | 'catalogItemCode' | 'plannedQuantity' | 'dueDate' | 'title' | 'assignerAccountId' | 'projectId'>>;

export const MAX_CONTENT_LENGTH = 4000;
export const MAX_CONSULTANTS = 10;
export const MAX_COMMENT_LENGTH = 4000;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES_PER_ASSIGNMENT = 30;
/** Định dạng tệp đính kèm được nhận (ADR-024 mục 6): đuôi tệp và kiểu nội dung lưu cho tệp đó. */
export const ALLOWED_FILE_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** MESSAGE: tin nhắn thường của mọi thành viên. OPINION: ý kiến tham vấn, chỉ người tham vấn gửi. */
export type CommentKind = 'MESSAGE' | 'OPINION';

/** Một tin nhắn trong mục trao đổi của việc. Không sửa, không xóa. */
export interface CommentModel {
  id: string;
  assignmentId: string;
  authorAccountId: string;
  authorPersonId: string | null;
  kind: CommentKind;
  body: string;
  createdAt: Date;
}
export type NewComment = Omit<CommentModel, 'id' | 'createdAt'>;

/** Tệp đính kèm của việc, hoặc của một tin nhắn. Không sửa, không xóa. */
export interface AttachmentModel {
  id: string;
  assignmentId: string;
  commentId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedByAccountId: string;
  uploadedAt: Date;
}
export type NewAttachment = Omit<AttachmentModel, 'id' | 'uploadedAt'>;

/**
 * Trạng thái suy ra của một việc, theo thứ tự ưu tiên: đã hủy, hoàn thành, có báo cáo chờ xác nhận, quá hạn, đang làm.
 */
export const ASSIGNMENT_STATES = ['PROPOSED', 'IN_PROGRESS', 'PENDING_CONFIRM', 'OVERDUE', 'DONE', 'CANCELLED'] as const;
export type AssignmentState = (typeof ASSIGNMENT_STATES)[number];

/** Nhiệm vụ do cấp trên đặt cho một cán bộ; chứa các công việc lấy từ danh mục (ADR-018). */
export interface WorkTaskModel {
  id: string;
  assigneePersonId: string;
  title: string;
  description: string | null;
  createdByAccountId: string | null;
}
export type NewWorkTask = Omit<WorkTaskModel, 'id'>;

/** Một lần cán bộ báo cáo đã hoàn thành một phần hoặc toàn bộ việc. */
export interface ProgressModel {
  id: string;
  assignmentId: string;
  quantity: number;
  /** Ngày hoàn thành thực tế, dạng YYYY-MM-DD. */
  completedOn: string;
  evidence: string | null;
  status: ProgressStatus;
  reportedBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  /** Chỉ có nghĩa khi bị từ chối: sai sót lớn về nội dung, bị trừ 25% điểm chất lượng (Nghị định 335/2025 Điều 14.2.b). */
  majorError: boolean;
}
export type NewProgress = Pick<ProgressModel, 'assignmentId' | 'quantity' | 'completedOn' | 'evidence' | 'reportedBy'>;
export type ProgressPatch = Partial<Pick<ProgressModel, 'status' | 'decidedBy' | 'decidedAt' | 'decisionNote' | 'majorError'>>;

/**
 * Miễn trừ do nguyên nhân khách quan (Nghị định 335/2025 Điều 14.2.b, c): cấp trên xác nhận kết quả của việc quyết định một lần
 * chậm hoặc một lần chưa đạt không bị trừ 25%. Lần báo cáo đã xử lý bị khóa nên miễn trừ nằm ở bản ghi riêng; thu hồi thì giữ
 * bản ghi, đánh dấu đã thu hồi (ADR-056).
 */
export type WaiverKind = 'LATE' | 'REWORK';
export interface WaiverModel {
  id: string;
  progressId: string;
  kind: WaiverKind;
  reason: string;
  grantedBy: string;
  grantedAt: Date;
  revokedBy: string | null;
  revokedAt: Date | null;
  revokeNote: string | null;
}
export type NewWaiver = Pick<WaiverModel, 'progressId' | 'kind' | 'reason' | 'grantedBy' | 'grantedAt'>;

/** Số liệu suy ra từ các lần báo cáo của một việc. */
export interface ProgressSummary {
  /** Tổng số lượng đã được cấp trên xác nhận. */
  confirmedQuantity: number;
  /** Tổng số lượng đang chờ cấp trên xác nhận. */
  pendingQuantity: number;
  /** Số lần báo cáo bị từ chối vì sai sót lớn (một lần chưa đạt, bị trừ 25%). Từ chối vì lý do nhỏ không tính. */
  reworkCount: number;
  /** Số lần báo cáo được xác nhận mà ngày hoàn thành sau hạn (một lần chậm). */
  lateCount: number;
  /** Số lần chậm và chưa đạt đã được miễn trừ: không nằm trong `lateCount`, `reworkCount` (không bị trừ). */
  waivedLateCount: number;
  waivedReworkCount: number;
  done: boolean;
}

/** Lần báo cáo này là một lần chậm (đã xác nhận mà ngày hoàn thành sau hạn) hay một lần chưa đạt (bị từ chối vì sai sót lớn), nếu có. */
export function penaltyOf(assignment: Pick<AssignmentModel, 'dueDate'>, progress: Pick<ProgressModel, 'status' | 'completedOn' | 'majorError'>): WaiverKind | null {
  if (progress.status === 'CONFIRMED' && progress.completedOn > assignment.dueDate) return 'LATE';
  if (progress.status === 'REJECTED' && progress.majorError) return 'REWORK';
  return null;
}

/** `waivedProgressIds`: các lần báo cáo đang được miễn trừ (chưa thu hồi); lần đó không tính vào số lần chậm, chưa đạt. */
export function summarize(
  assignment: Pick<AssignmentModel, 'plannedQuantity' | 'dueDate'>,
  progress: readonly ProgressModel[],
  waivedProgressIds: ReadonlySet<string> = new Set(),
): ProgressSummary {
  let confirmedQuantity = 0;
  let pendingQuantity = 0;
  let reworkCount = 0;
  let lateCount = 0;
  let waivedLateCount = 0;
  let waivedReworkCount = 0;
  for (const p of progress) {
    if (p.status === 'CONFIRMED') confirmedQuantity += p.quantity;
    else if (p.status === 'REPORTED') pendingQuantity += p.quantity;
    const penalty = penaltyOf(assignment, p);
    if (penalty === null) continue;
    const waived = waivedProgressIds.has(p.id);
    if (penalty === 'LATE') {
      if (waived) waivedLateCount += 1;
      else lateCount += 1;
    } else if (waived) {
      waivedReworkCount += 1;
    } else {
      reworkCount += 1;
    }
  }
  return { confirmedQuantity, pendingQuantity, reworkCount, lateCount, waivedLateCount, waivedReworkCount, done: confirmedQuantity >= assignment.plannedQuantity };
}

export function stateOf(assignment: Pick<AssignmentModel, 'status' | 'dueDate'>, summary: ProgressSummary, today: string): AssignmentState {
  if (assignment.status === 'CANCELLED') return 'CANCELLED';
  if (assignment.status === 'PROPOSED') return 'PROPOSED';
  if (summary.done) return 'DONE';
  if (summary.pendingQuantity > 0) return 'PENDING_CONFIRM';
  if (assignment.dueDate < today) return 'OVERDUE';
  return 'IN_PROGRESS';
}

/** Kỳ cần tổng hợp: chỉ cần loại và khoảng ngày (gồm cả ngày đầu và cuối). */
export interface PeriodRange {
  type: ReportKind;
  startDate: string;
  endDate: string;
}

/** Việc có hạn trong kỳ, và loại kỳ nằm trong số loại báo cáo được chọn. */
export function belongsToPeriod(a: Pick<AssignmentModel, 'status' | 'dueDate' | 'reportKinds'>, period: PeriodRange): boolean {
  return a.status === 'OPEN' && a.dueDate >= period.startDate && a.dueDate <= period.endDate && a.reportKinds.includes(period.type);
}

/** Dữ liệu một việc sau khi đã chốt, dùng để điền hồ sơ kỳ (ADR-016 mục 5). */
export interface AssignedWork extends ProgressSummary {
  assignmentId: string;
  /** Tên nhiệm vụ chứa công việc, để ghi nguồn vào dòng hồ sơ. */
  taskTitle: string;
  personId: string;
  /** Vị trí mà việc được giao cho (ADR-047); null: chưa xác định, hiểu là vị trí chính. */
  positionId: string | null;
  catalogItemCode: string;
  plannedQuantity: number;
  evidence: string | null;
}

/** `YYYY-MM-DD` theo giờ Việt Nam (UTC+7), để ngày không lệch khi máy chủ chạy giờ UTC. */
export function todayVietnam(now: Date): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
