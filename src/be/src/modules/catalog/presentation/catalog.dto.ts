import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ITEM_CODE_PATTERN, MAX_COMPLEXITY, MIN_COMPLEXITY } from '../application/catalog.model.js';
import type { DurationMode, DurationUnit } from '../application/catalog.model.js';

const DURATION_MODES = ['LIMITED', 'ACTUAL', 'UNSPECIFIED'] as const;
const DURATION_UNITS = ['HOUR', 'DAY'] as const;

export class CreateVersionDto {
  /** Tên danh mục; bỏ trống thì lấy tên của bản sao chép hoặc nhãn. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsUUID()
  copyFromVersionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  sourceNote?: string;
}

export class CreateGroupDto {
  /** Một chữ cái A–Z; bỏ trống thì máy chủ lấy chữ cái kế tiếp còn trống. */
  @IsOptional()
  @Matches(/^[A-Za-z]$/, { message: 'code là một chữ cái từ A đến Z' })
  code?: string;

  @IsString()
  @MaxLength(255)
  name: string;
}

export class UpdateGroupDto {
  @IsString()
  @MaxLength(255)
  name: string;
}

export class CreateCatalogTaskDto {
  @Matches(/^[A-Z]$/, { message: 'groupCode là một chữ cái từ A đến Z' })
  groupCode: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateCatalogTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class ScopeDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  unitIds: string[];

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  positionIds: string[];
}

export class UpdateVersionDto {
  @IsString()
  @MaxLength(200)
  name: string;
}

export class AddItemDto {
  /** Nhiệm vụ chứa công việc; có thì mã được tự sinh nếu bỏ trống `code`. */
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @Matches(ITEM_CODE_PATTERN, { message: 'code có dạng A.001 (chữ cái nhóm A–D, dấu chấm, 3 chữ số)' })
  code?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  productUnits?: string;

  @IsInt()
  @Min(MIN_COMPLEXITY)
  @Max(MAX_COMPLEXITY)
  complexity: number;

  @IsIn(DURATION_MODES)
  durationMode: DurationMode;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationValue?: number;

  @IsOptional()
  @IsIn(DURATION_UNITS)
  durationUnit?: DurationUnit;

  @IsOptional()
  @IsNumber()
  @Min(0)
  points?: number;

  @IsOptional()
  @IsString()
  explanation?: string;
}

export class UpdateItemDto {
  /** Chuyển công việc sang nhiệm vụ khác cùng nhóm. */
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  productUnits?: string | null;

  @IsOptional()
  @IsInt()
  @Min(MIN_COMPLEXITY)
  @Max(MAX_COMPLEXITY)
  complexity?: number;

  @IsOptional()
  @IsIn(DURATION_MODES)
  durationMode?: DurationMode;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationValue?: number | null;

  @IsOptional()
  @IsIn(DURATION_UNITS)
  durationUnit?: DurationUnit | null;

  /** Truyền null để xóa điểm chấm (công việc quay về trạng thái chưa có định mức). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  points?: number | null;

  @IsOptional()
  @IsString()
  explanation?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class SetBaselineDto {
  @Matches(ITEM_CODE_PATTERN)
  itemCode: string;
}

export class ApproveVersionDto {
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;
}

/** Lý do ngừng sử dụng (không bắt buộc). */
export class DeactivateCatalogDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
