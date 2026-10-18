import type {
  EvaluationModel,
  EvaluationPatch,
  NewEvaluation,
  NewPeriod,
  NewTask,
  PeriodModel,
  TaskModel,
  TaskPatch,
} from './evaluation.model.js';
import type { Rating } from '../../scoring/index.js';

/** Mức xếp loại năm của đơn vị mà cán bộ làm người đứng đầu (Điều 20.6); null nếu không đứng đầu đơn vị nào hoặc chưa có mức. */
export interface HeadedUnitRating {
  unitName: string;
  rating: Rating;
  /** Đã được công nhận (hồ sơ tập thể ở trạng thái phê duyệt). */
  approved: boolean;
}

/** Các cổng của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class PeriodRepository {
  abstract findById(id: string): Promise<PeriodModel | null>;
  abstract findByLabel(label: string): Promise<PeriodModel | null>;
  abstract findAll(): Promise<PeriodModel[]>;
  abstract create(data: NewPeriod): Promise<PeriodModel>;
  abstract close(id: string): Promise<void>;
  abstract setDeadline(id: string, date: string | null): Promise<void>;
}

export abstract class EvaluationRepository {
  abstract findById(id: string): Promise<EvaluationModel | null>;
  /** Phiếu của cán bộ ở một vị trí trong kỳ (khóa duy nhất: kỳ, cán bộ, vị trí; ADR-047). */
  abstract findByPeriodPersonPosition(periodId: string, personId: string, positionId: string): Promise<EvaluationModel | null>;
  /** Mọi phiếu của cán bộ trong kỳ: nhiều hơn một khi cán bộ kiêm nhiệm. */
  abstract findByPersonInPeriod(periodId: string, personId: string): Promise<EvaluationModel[]>;
  abstract findByPeriod(periodId: string): Promise<EvaluationModel[]>;
  abstract create(data: NewEvaluation): Promise<EvaluationModel>;
  abstract update(id: string, patch: EvaluationPatch): Promise<EvaluationModel>;
}

export abstract class TaskRepository {
  abstract findById(id: string): Promise<TaskModel | null>;
  abstract findByEvaluation(evaluationId: string): Promise<TaskModel[]>;
  abstract create(data: NewTask): Promise<TaskModel>;
  abstract update(id: string, patch: TaskPatch): Promise<TaskModel>;
  abstract delete(id: string): Promise<void>;
}

/** Một vị trí cấp trên và người đang giữ (null nếu vị trí đang trống). */
export interface Superior {
  positionId: string;
  level: number;
  personId: string | null;
}

export interface PositionInfo {
  positionId: string;
  unitId?: string;
  level: number;
  isLeader?: boolean;
  /** Vị trí hỗ trợ, phục vụ (ADR-053). */
  isSupport?: boolean;
}

/** Một vị trí cán bộ giữ, là vị trí chính hay kiêm nhiệm (ADR-047). */
export interface Placement extends PositionInfo {
  kind: 'PRIMARY' | 'CONCURRENT';
}

/** Cổng sang mô-đun organization: ai là cấp trên của ai tại thời điểm này. */
export abstract class OrgDirectory {
  /** Vị trí chính cán bộ đang giữ, hoặc null. */
  abstract positionOf(personId: string): Promise<PositionInfo | null>;
  /** Thông tin một vị trí (dù hiện có người giữ hay không), hoặc null nếu không tồn tại. */
  abstract positionInfo(positionId: string): Promise<PositionInfo | null>;
  /** Các vị trí cán bộ giữ trong khoảng [from, to] (chỉ cần giao nhau), vị trí chính trước. */
  abstract placementsDuring(personId: string, from: Date, to: Date): Promise<Placement[]>;
  /** Chuỗi cấp trên từ trực tiếp lên gốc, tính từ vị trí `positionId` nếu nêu, không thì từ vị trí chính. */
  abstract superiorsOf(personId: string, positionId?: string): Promise<Superior[]>;
  /** Người giữ các vị trí cấp dưới (trực tiếp hoặc mọi cấp); nêu `positionId` thì chỉ tính cấp dưới của vị trí đó. */
  abstract subordinateHolders(personId: string, options: { direct: boolean; positionId?: string }): Promise<string[]>;
}

/** Một việc được giao đã chốt số liệu, thuộc kỳ đang tổng hợp (ADR-016). */
export interface PeriodWork {
  assignmentId: string;
  /** Tên nhiệm vụ chứa việc này. */
  taskTitle: string;
  personId: string;
  /** Vị trí mà việc được giao cho (ADR-047); null với việc giao trước khi có kiêm nhiệm: tính vào vị trí chính. */
  positionId?: string | null;
  catalogItemCode: string;
  plannedQuantity: number;
  /** Số lượng đã được cấp trên xác nhận. */
  confirmedQuantity: number;
  lateCount: number;
  reworkCount: number;
  /** Số lần chậm, chưa đạt đã được miễn trừ do nguyên nhân khách quan; không nằm trong `lateCount`, `reworkCount` (ADR-056). */
  waivedLateCount?: number;
  waivedReworkCount?: number;
  evidence: string | null;
}

/** Cổng sang mô-đun tasking: các việc thuộc một kỳ. */
export abstract class PeriodWorkSource {
  abstract collect(period: { type: 'MONTH' | 'QUARTER' | 'YEAR'; startDate: string; endDate: string }): Promise<PeriodWork[]>;
}

export interface CatalogItemInfo {
  name: string;
  points: number | null;
  coefficient: number | null;
  /** Phạm vi áp dụng (ADR-021); thiếu hoặc rỗng cả hai là việc chung. */
  unitIds?: string[];
  positionIds?: string[];
}

export interface CatalogVersionInfo {
  id: string;
  status: 'DRAFT' | 'APPROVED';
  items: Map<string, CatalogItemInfo>;
}

/** Cổng sang mô-đun catalog. */
export abstract class CatalogDirectory {
  abstract currentApprovedVersionId(): Promise<string | null>;
  abstract getVersion(versionId: string): Promise<CatalogVersionInfo | null>;
}

/**
 * Số việc được giao và đã hoàn thành trong kỳ của đơn vị chứa vị trí (gồm các đơn vị cấp dưới), để xét điều kiện "đơn vị phụ trách
 * hoàn thành dưới 70% nhiệm vụ" của cán bộ lãnh đạo (39-QĐ/TU mục 4.2.a). null khi vị trí không thuộc đơn vị nào.
 */
export abstract class UnitCompletionSource {
  abstract of(positionId: string, period: { type: 'MONTH' | 'QUARTER' | 'YEAR'; startDate: string; endDate: string }): Promise<{ unitName: string; works: number; completed: number } | null>;
}

/** Cổng sang đánh giá tập thể: mức của đơn vị do cán bộ đứng đầu trong kỳ năm. */
export abstract class HeadedUnitRatingSource {
  abstract of(personId: string, periodId: string, positionId?: string): Promise<HeadedUnitRating | null>;
}
