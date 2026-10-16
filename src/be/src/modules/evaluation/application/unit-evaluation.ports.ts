import type { NewUnitEvaluation, UnitEvaluationModel, UnitEvaluationPatch, UnitInfo } from './unit-evaluation.model.js';
import type { AxisDefinition } from './unit-axes.js';

/** Các cổng của lớp nghiệp vụ đánh giá tập thể (abstract class để làm token DI). */
export abstract class UnitEvaluationRepository {
  abstract findById(id: string): Promise<UnitEvaluationModel | null>;
  abstract findByPeriodAndUnit(periodId: string, unitId: string): Promise<UnitEvaluationModel | null>;
  abstract findByPeriod(periodId: string): Promise<UnitEvaluationModel[]>;
  abstract create(data: NewUnitEvaluation): Promise<UnitEvaluationModel>;
  abstract update(id: string, patch: UnitEvaluationPatch): Promise<UnitEvaluationModel>;
}

/** Cổng sang mô-đun organization: các đơn vị hiện có, người đứng đầu và thành viên. */
export abstract class UnitDirectory {
  abstract units(): Promise<UnitInfo[]>;
}

/** Cấu hình các trục chấm điểm tập thể (ADR-036). */
export abstract class UnitAxisRepository {
  abstract findAll(): Promise<AxisDefinition[]>;
  /** Thay toàn bộ danh sách trục. */
  abstract replaceAll(axes: readonly AxisDefinition[]): Promise<void>;
}
