import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { PeriodType } from '../application/evaluation.model.js';

const PERIOD_TYPES = ['MONTH', 'QUARTER', 'YEAR'] as const;

export class CreatePeriodDto {
  @IsIn(PERIOD_TYPES)
  type: PeriodType;

  @IsInt()
  year: number;

  /** Tháng 1–12 hoặc quý 1–3; bỏ trống với kỳ năm. */
  @IsOptional()
  @IsInt()
  number?: number;

  @IsOptional()
  @IsUUID()
  catalogVersionId?: string;
}

export class CreateEvaluationDto {
  @IsUUID()
  personId: string;
}

export class AddTaskDto {
  @Matches(/^[A-Z]\.\d{3}$/, { message: 'catalogItemCode có dạng A.001' })
  catalogItemCode: string;

  @IsInt()
  plannedQuantity: number;
}

export class RecordResultDto {
  @IsInt()
  completedQuantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidence?: string;
}

export class SelfSubmitDto {
  @IsNumber()
  generalScore: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ReviewTaskDto {
  @IsUUID()
  taskId: string;

  @IsOptional()
  @IsInt()
  qualityLevel?: number;

  @IsOptional()
  @IsInt()
  completedQuantity?: number;
}

/** Ba tiêu chí lãnh đạo, chỉ đạo (D): mỗi tiêu chí đạt 1 (100%) hoặc 0,5 (50%). */
export class LeadershipDto {
  @IsIn([0.5, 1])
  unitResult: number;

  @IsIn([0.5, 1])
  organizing: number;

  @IsIn([0.5, 1])
  solidarity: number;
}

export class ReviewDto {
  @IsNumber()
  generalScore: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => LeadershipDto)
  leadership?: LeadershipDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReviewTaskDto)
  tasks: ReviewTaskDto[];
}

export class ReturnDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}

export class ApproveEvaluationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
