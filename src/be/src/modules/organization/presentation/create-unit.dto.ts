import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { UNIT_TYPES } from '../application/unit.model.js';
import type { UnitType } from '../application/unit.model.js';

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(UNIT_TYPES)
  type?: UnitType;

  /** Truyền null để bỏ đơn vị cha. */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class CreateUnitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsIn(UNIT_TYPES)
  type: UnitType;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}

/** Lý do ngừng sử dụng (không bắt buộc). */
export class DeactivateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
