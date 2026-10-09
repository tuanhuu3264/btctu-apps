import type { NewUnit, UnitModel, UnitPatch } from './unit.model.js';

/**
 * Cổng truy cập dữ liệu của lớp nghiệp vụ. Là abstract class để dùng làm token
 * dependency injection; lớp nghiệp vụ không biết TypeORM (ADR-010 mục 7).
 */
export abstract class UnitRepository {
  abstract findAll(): Promise<UnitModel[]>;
  abstract findById(id: string): Promise<UnitModel | null>;
  abstract findByCode(code: string): Promise<UnitModel | null>;
  abstract create(data: NewUnit): Promise<UnitModel>;
  abstract update(id: string, patch: UnitPatch): Promise<UnitModel>;
  /** IN_USE: còn đơn vị con, vị trí hay phạm vi công việc trỏ tới nên không xóa được. */
  abstract delete(id: string): Promise<'OK' | 'IN_USE'>;
}
