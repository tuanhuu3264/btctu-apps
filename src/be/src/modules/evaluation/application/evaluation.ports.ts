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

/** Các cổng của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class PeriodRepository {
  abstract findById(id: string): Promise<PeriodModel | null>;
  abstract findByLabel(label: string): Promise<PeriodModel | null>;
  abstract findAll(): Promise<PeriodModel[]>;
  abstract create(data: NewPeriod): Promise<PeriodModel>;
  abstract close(id: string): Promise<void>;
}

export abstract class EvaluationRepository {
  abstract findById(id: string): Promise<EvaluationModel | null>;
  abstract findByPeriodAndPerson(periodId: string, personId: string): Promise<EvaluationModel | null>;
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

/** Cổng sang mô-đun organization: ai là cấp trên của ai tại thời điểm này. */
export abstract class OrgDirectory {
  /** Vị trí cán bộ đang giữ, hoặc null. */
  abstract positionOf(personId: string): Promise<{ positionId: string; unitId?: string; level: number; isLeader?: boolean } | null>;
  /** Chuỗi cấp trên từ trực tiếp lên gốc. */
  abstract superiorsOf(personId: string): Promise<Superior[]>;
  /** Người giữ các vị trí cấp dưới (trực tiếp hoặc mọi cấp). */
  abstract subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]>;
}

/** Một việc được giao đã chốt số liệu, thuộc kỳ đang tổng hợp (ADR-016). */
export interface PeriodWork {
  assignmentId: string;
  /** Tên nhiệm vụ chứa việc này. */
  taskTitle: string;
  personId: string;
  catalogItemCode: string;
  plannedQuantity: number;
  /** Số lượng đã được cấp trên xác nhận. */
  confirmedQuantity: number;
  lateCount: number;
  reworkCount: number;
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
