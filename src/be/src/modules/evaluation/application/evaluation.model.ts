import type { Rating } from '../../scoring/index.js';
import type { Leadership } from './scoring-policy.js';

export type PeriodType = 'MONTH' | 'QUARTER' | 'YEAR';
export type PeriodStatus = 'OPEN' | 'CLOSED';

export interface PeriodModel {
  id: string;
  type: PeriodType;
  year: number;
  /** Tháng 1–12, quý 1–3, hoặc null với năm. */
  number: number | null;
  /** Nhãn ngắn, duy nhất: 2026-M09, 2026-Q3, 2026. */
  label: string;
  /** Ngày bắt đầu và ngày kết thúc (gồm cả ngày đó), dạng YYYY-MM-DD. */
  startDate: string;
  endDate: string;
  /** Phiên bản danh mục đã phê duyệt dùng để tính hệ số của kỳ này. */
  catalogVersionId: string;
  status: PeriodStatus;
  createdBy: string | null;
}
export type NewPeriod = Omit<PeriodModel, 'id' | 'status'>;

/** Luồng của hồ sơ (ADR-014 mục 3). APPROVED là trạng thái cuối, khóa hồ sơ. */
export type EvaluationStatus = 'PLANNED' | 'SELF_SUBMITTED' | 'REVIEWED' | 'APPROVED';
export type QualityLevel = 1 | 2 | 3;

export interface EvaluationModel {
  id: string;
  periodId: string;
  personId: string;
  /** Vị trí mà cán bộ giữ khi hồ sơ được tạo. */
  positionId: string;
  status: EvaluationStatus;
  selfGeneralScore: number | null;
  selfComment: string | null;
  selfSubmittedAt: Date | null;
  /** Điểm tiêu chí chung (0–30) do người thẩm định chấm. */
  generalScore: number | null;
  reviewComment: string | null;
  reviewerAccountId: string | null;
  reviewedAt: Date | null;
  approverAccountId: string | null;
  approvedAt: Date | null;
  approveComment: string | null;
  returnReason: string | null;
  /** Kết quả tính khi thẩm định (đề xuất) và giữ nguyên khi phê duyệt. */
  resultScore: number | null;
  totalScore: number | null;
  rating: Rating | null;
  scoringParams: Record<string, unknown> | null;
  /** Ba tiêu chí lãnh đạo, chỉ đạo (D) do người thẩm định chấm; null với cán bộ không lãnh đạo, quản lý. */
  leadership: Leadership | null;
  createdBy: string | null;
}
export type NewEvaluation = Pick<EvaluationModel, 'periodId' | 'personId' | 'positionId' | 'createdBy'>;
export type EvaluationPatch = Partial<Omit<EvaluationModel, 'id' | 'periodId' | 'personId' | 'positionId' | 'createdBy'>>;

export interface TaskModel {
  id: string;
  evaluationId: string;
  catalogItemCode: string;
  plannedQuantity: number;
  completedQuantity: number;
  /** 1: chủ động, hiệu quả; 2: cơ bản đáp ứng; 3: không đáp ứng (05-HD/TU mục IV.1.2). null: chưa đánh giá. */
  qualityLevel: number | null;
  evidence: string | null;
  /** Các việc được giao đã gộp thành dòng này (ADR-016). Rỗng: dòng nhập tay. */
  sourceAssignmentIds: string[];
  /** Tên các nhiệm vụ chứa những việc nguồn, để người đọc hồ sơ biết dòng đến từ nhiệm vụ nào (ADR-018). */
  sourceTaskTitles: string[];
  /** Số lần chậm tiến độ và số lần chưa đạt, lấy từ các việc nguồn; chuẩn bị cho B và C của Phụ lục 2 (G-02). */
  lateCount: number;
  reworkCount: number;
}
export type NewTask = Pick<TaskModel, 'evaluationId' | 'catalogItemCode' | 'plannedQuantity'> &
  Partial<Pick<TaskModel, 'completedQuantity' | 'evidence' | 'sourceAssignmentIds' | 'sourceTaskTitles' | 'lateCount' | 'reworkCount'>>;
export type TaskPatch = Partial<
  Pick<TaskModel, 'plannedQuantity' | 'completedQuantity' | 'qualityLevel' | 'evidence' | 'sourceAssignmentIds' | 'sourceTaskTitles' | 'lateCount' | 'reworkCount'>
>;

export const QUALITY_LEVELS: readonly number[] = [1, 2, 3];
export const MAX_QUANTITY = 100_000;
