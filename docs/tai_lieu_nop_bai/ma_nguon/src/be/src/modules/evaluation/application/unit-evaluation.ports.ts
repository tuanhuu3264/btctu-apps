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

/**
 * Cấu hình các trục chấm điểm tập thể (ADR-036), theo bộ (ADR-052): `unitId` null là bộ mặc định (hồ sơ của Ban và phòng
 * chưa có bộ riêng), còn lại là bộ riêng của một đơn vị.
 */
export abstract class UnitAxisRepository {
  /** Các trục của một bộ, kể cả trục đã tắt; rỗng nếu đơn vị chưa có bộ riêng. */
  abstract findSet(unitId: string | null): Promise<AxisDefinition[]>;
  /** Đơn vị đã có bộ trục riêng. */
  abstract unitsWithOwnSet(): Promise<string[]>;
  /** Thay toàn bộ một bộ trục; danh sách rỗng với một đơn vị là bỏ bộ riêng để dùng lại bộ mặc định. */
  abstract replaceSet(unitId: string | null, axes: readonly AxisDefinition[]): Promise<void>;
}
