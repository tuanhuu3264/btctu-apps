import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import type { PeriodType } from '../application/evaluation.model.js';

const PERIOD_TYPES = ['MONTH', 'QUARTER', 'YEAR'] as const;

export class SetDeadlineDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'deadline phải có dạng YYYY-MM-DD' })
  deadline: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

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

  /** Vị trí lập phiếu; bỏ trống thì lấy vị trí chính. Cán bộ kiêm nhiệm có phiếu riêng cho mỗi vị trí (ADR-047). */
  @IsOptional()
  @IsUUID()
  positionId?: string;
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
  /** Bắt buộc với kỳ tháng, quý; kỳ năm không tự chấm điểm (ADR-035). */
  @IsOptional()
  @IsNumber()
  generalScore?: number;

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
  /** Bắt buộc với kỳ tháng, quý; kỳ năm là trung bình các tháng nên bỏ qua (ADR-035). */
  @IsOptional()
  @IsNumber()
  generalScore?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => LeadershipDto)
  leadership?: LeadershipDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReviewTaskDto)
  tasks?: ReviewTaskDto[];
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

/** Điểm một trục của hồ sơ tập thể (ADR-036). */
export class AxisScoreDto {
  @IsString()
  @MaxLength(10)
  code: string;

  @IsNumber()
  score: number;
}

/**
 * Điểm của hồ sơ tập thể: điểm từng trục đang bật (ADR-036); nhóm không có trục nào đang bật thì nhập một số,
 * tiêu chí chung 0–30 và kết quả thực hiện nhiệm vụ 0–70 (ADR-030).
 */
export class UnitScoreDto {
  @IsOptional()
  @IsNumber()
  generalScore?: number;

  @IsOptional()
  @IsNumber()
  resultScore?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AxisScoreDto)
  axes?: AxisScoreDto[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

/** Định nghĩa một trục chấm điểm tập thể khi cấu hình (ADR-036). */
export class AxisDefinitionDto {
  @IsString()
  @MaxLength(10)
  code: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsIn(['GENERAL', 'RESULT'])
  kind: 'GENERAL' | 'RESULT';

  @IsNumber()
  maxPoints: number;

  @IsInt()
  sortOrder: number;

  @IsOptional()
  @IsIn(['COMPLETED_SHARE'])
  autoMetric?: 'COMPLETED_SHARE' | null;

  @IsBoolean()
  active: boolean;
}

export class ReplaceAxesDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AxisDefinitionDto)
  axes: AxisDefinitionDto[];
}

/** Ghi nhận khiếu nại, phản ánh về tập thể (ADR-038). */
export class CreateComplaintDto {
  @IsIn(['KHIEU_NAI', 'TO_CAO', 'PHAN_ANH', 'MAT_DOAN_KET'])
  kind: 'KHIEU_NAI' | 'TO_CAO' | 'PHAN_ANH' | 'MAT_DOAN_KET';

  @IsString()
  @MaxLength(4000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  source?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  receivedOn?: string;
}

export class DirectVerificationDto {
  @IsString()
  @MaxLength(200)
  assignee: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;
}

export class CloseComplaintDto {
  @IsIn(['SUBSTANTIATED', 'UNFOUNDED'])
  outcome: 'SUBSTANTIATED' | 'UNFOUNDED';

  @IsString()
  @MaxLength(4000)
  conclusion: string;
}

export class LeaveMonthDto {
  @IsInt()
  month: number;

  @IsIn(['OM', 'THAI_SAN', 'KHONG_LUONG', 'KHAC'])
  reason: 'OM' | 'THAI_SAN' | 'KHONG_LUONG' | 'KHAC';

  @IsString()
  @MaxLength(500)
  note: string;
}

/** Thay toàn bộ các tháng nghỉ của cán bộ trong một năm (ADR-039). */
export class SetLeaveDto {
  @IsInt()
  year: number;

  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => LeaveMonthDto)
  months: LeaveMonthDto[];
}

export class NotRatedDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
