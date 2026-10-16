import {
  IsEmail,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { GENDERS, MAX_LEVEL, MIN_LEVEL, POLITICAL_THEORY_LEVELS } from '../application/org.model.js';
import type { Gender, PoliticalTheory } from '../application/org.model.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Hồ sơ cán bộ mở rộng (ADR-023). Mọi trường không bắt buộc; null hoặc chuỗi rỗng khi sửa là xóa giá trị. */
export class PersonProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  employeeCode?: string | null;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  ethnicity?: string | null;

  @IsOptional()
  @Matches(DATE, { message: 'Ngày sinh có dạng YYYY-MM-DD' })
  dateOfBirth?: string | null;

  @IsOptional()
  @Matches(/^[0-9]{12}$/, { message: 'Số định danh cá nhân (CCCD) gồm đúng 12 chữ số' })
  nationalId?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @MaxLength(160)
  email?: string | null;

  @IsOptional()
  @Matches(/^(\+84|0)[0-9]{9,10}$/, { message: 'Số điện thoại không đúng định dạng' })
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  rank?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  salaryGrade?: string | null;

  @IsOptional()
  @Matches(DATE, { message: 'Ngày vào cơ quan có dạng YYYY-MM-DD' })
  joinedAgencyOn?: string | null;

  @IsOptional()
  @Matches(DATE, { message: 'Ngày vào Đảng có dạng YYYY-MM-DD' })
  partyJoinedOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  education?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  major?: string | null;

  @IsOptional()
  @IsIn(POLITICAL_THEORY_LEVELS)
  politicalTheory?: PoliticalTheory | null;
}

export class CreatePersonDto extends PersonProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class UpdatePersonDto extends PersonProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class PersonQueryDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  active?: boolean;
}

export class CreatePositionDto {
  @Matches(/^[A-Z0-9][A-Z0-9-]{2,79}$/, { message: 'code gồm 3–80 ký tự: chữ hoa, số, gạch nối' })
  code: string;

  @IsUUID()
  unitId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsInt()
  @Min(MIN_LEVEL)
  @Max(MAX_LEVEL)
  level: number;

  /** Bỏ trống thì lấy theo cấp (cấp 1 đến 4 là lãnh đạo, quản lý). */
  @IsOptional()
  @IsBoolean()
  isLeader?: boolean;

  @IsOptional()
  @IsUUID()
  reportsToPositionId?: string;

  @IsOptional()
  @IsString()
  duties?: string;

  @IsOptional()
  @IsString()
  referenceOkr?: string;
}

export class UpdatePositionDto {
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_LEVEL)
  @Max(MAX_LEVEL)
  level?: number;

  @IsOptional()
  @IsBoolean()
  isLeader?: boolean;

  /** Truyền null để bỏ cấp trên (chỉ hợp lệ với cấp 1). */
  @IsOptional()
  @IsUUID()
  reportsToPositionId?: string | null;

  @IsOptional()
  @IsString()
  duties?: string | null;

  @IsOptional()
  @IsString()
  referenceOkr?: string | null;
}

export class IncludeInactiveQueryDto {
  /** 'true': lấy cả đơn vị/vị trí đã ngừng sử dụng. */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: string;
}

export class OrgExportQueryDto extends IncludeInactiveQueryDto {
  @IsIn(['units', 'positions', 'persons'])
  list: 'units' | 'positions' | 'persons';

  @IsIn(['xlsx', 'pdf'])
  format: 'xlsx' | 'pdf';
}

export class PositionQueryDto extends IncludeInactiveQueryDto {
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

export class SubordinatesQueryDto {
  @IsOptional()
  @IsIn(['true', 'false'])
  direct?: string;
}

export class AssignDto {
  @IsUUID()
  personId: string;

  /** Không nêu: phân công chính. CONCURRENT: kiêm nhiệm thêm vị trí này (ADR-047). */
  @IsOptional()
  @IsIn(['PRIMARY', 'CONCURRENT'])
  kind?: 'PRIMARY' | 'CONCURRENT';

  @IsOptional()
  @IsDateString()
  validFrom?: string;
}

export class EndAssignmentDto {
  @IsOptional()
  @IsDateString()
  validTo?: string;
}

export class LinkAccountDto {
  @IsUUID()
  accountId: string;
}

/** Bỏ các khóa undefined (DTO khai báo thuộc tính nên khóa luôn tồn tại) để cập nhật một phần không ghi đè. */
export function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}
