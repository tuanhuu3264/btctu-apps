import type {
  AssignmentModel,
  NewAssignment,
  NewPerson,
  NewPosition,
  PersonModel,
  PersonPatch,
  PositionModel,
  PositionPatch,
} from './org.model.js';
import type { InactiveInfo } from './unit.model.js';

/** Các cổng truy cập dữ liệu của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class PersonRepository {
  abstract findById(id: string): Promise<PersonModel | null>;
  abstract findAll(filter?: { active?: boolean }): Promise<PersonModel[]>;
  abstract findByFullName(fullName: string): Promise<PersonModel[]>;
  abstract findByEmployeeCode(code: string): Promise<PersonModel | null>;
  abstract findByNationalId(nationalId: string): Promise<PersonModel | null>;
  abstract create(data: NewPerson): Promise<PersonModel>;
  abstract update(id: string, patch: PersonPatch): Promise<PersonModel>;
  abstract setActive(id: string, active: boolean): Promise<void>;
}

export abstract class PositionRepository {
  abstract findById(id: string): Promise<PositionModel | null>;
  abstract findByCode(code: string): Promise<PositionModel | null>;
  abstract findAll(filter?: { unitId?: string }): Promise<PositionModel[]>;
  abstract create(data: NewPosition): Promise<PositionModel>;
  abstract update(id: string, patch: PositionPatch): Promise<PositionModel>;
  /** Đổi trạng thái (không xóa dòng). */
  abstract setStatus(id: string, info: InactiveInfo): Promise<PositionModel>;
}

export abstract class AssignmentRepository {
  abstract findById(id: string): Promise<AssignmentModel | null>;
  abstract findAll(): Promise<AssignmentModel[]>;
  abstract findByPerson(personId: string): Promise<AssignmentModel[]>;
  abstract findByPosition(positionId: string): Promise<AssignmentModel[]>;
  abstract create(data: NewAssignment): Promise<AssignmentModel>;
  abstract end(id: string, at: Date): Promise<void>;
}
