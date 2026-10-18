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

/** Ba tiêu chí của vị trí hỗ trợ, phục vụ (ADR-053), mỗi tiêu chí 0–100%; lớp nghiệp vụ kiểm khoảng giá trị. */
export class SupportScoresDto {
  @IsNumber()
  quality: number;

  @IsNumber()
  compliance: number;

  @IsNumber()
  efficiency: number;
}

/** Kết quả chấm một mục tiêu chí chung (ADR-054); lớp nghiệp vụ kiểm mã mục và căn cứ. */
export class GeneralMarkDto {
  @IsString()
  @MaxLength(10)
  code: string;

  @IsBoolean()
  ok: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class SelfSubmitDto {
  /** Kỳ tháng, quý chưa có bảng tiêu chí chung: điểm một ô 0–30. Kỳ năm không tự chấm điểm (ADR-035). */
  @IsOptional()
  @IsNumber()
  generalScore?: number;

  /** Kỳ tháng, quý có bảng tiêu chí chung: chấm từng mục (ADR-054). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => GeneralMarkDto)
  general?: GeneralMarkDto[];

  /** Bắt buộc với vị trí hỗ trợ, phục vụ ở kỳ tháng, quý. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportScoresDto)
  support?: SupportScoresDto;

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
  /** Kỳ tháng, quý chưa có bảng tiêu chí chung: điểm một ô 0–30. Kỳ năm là trung bình các tháng nên bỏ qua (ADR-035). */
  @IsOptional()
  @IsNumber()
  generalScore?: number;

  /** Kỳ tháng, quý có bảng tiêu chí chung: chấm từng mục (ADR-054). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => GeneralMarkDto)
  general?: GeneralMarkDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => LeadershipDto)
  leadership?: LeadershipDto;

  /** Bắt buộc với vị trí hỗ trợ, phục vụ; không gửi với vị trí khác. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportScoresDto)
  support?: SupportScoresDto;

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

/** Ngoại lệ khi hồ sơ năm có điều kiện "Không hoàn thành nhiệm vụ" (ADR-055). */
export class ConditionExceptionDto {
  @IsIn(['TU_GIAC_KHAC_PHUC', 'DA_TINH_NAM_TRUOC', 'VI_PHAM_DON_VI_CU', 'BAT_KHA_KHANG', 'KHONG_THE_BIET'])
  code: 'TU_GIAC_KHAC_PHUC' | 'DA_TINH_NAM_TRUOC' | 'VI_PHAM_DON_VI_CU' | 'BAT_KHA_KHANG' | 'KHONG_THE_BIET';

  @IsString()
  @MaxLength(2000)
  note: string;
}

export class ApproveEvaluationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ConditionExceptionDto)
  exception?: ConditionExceptionDto;
}

/** Ghi nhận kỷ luật, kết luận, kết quả lấy phiếu ảnh hưởng xếp loại (ADR-055); lớp nghiệp vụ kiểm các trường theo loại. */
export class CreateRatingEventDto {
  @IsIn(['KY_LUAT', 'SUY_THOAI', 'TIN_NHIEM_THAP', 'THAM_NHUNG_PHAM_VI'])
  kind: 'KY_LUAT' | 'SUY_THOAI' | 'TIN_NHIEM_THAP' | 'THAM_NHUNG_PHAM_VI';

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'effectiveDate có dạng YYYY-MM-DD' })
  effectiveDate: string;

  @IsString()
  @MaxLength(100)
  decisionNo: string;

  @IsOptional()
  @IsIn(['KHIEN_TRACH', 'CANH_CAO', 'HA_BAC_LUONG', 'GIANG_CHUC', 'CACH_CHUC', 'BUOC_THOI_VIEC', 'KHAI_TRU'])
  form?: 'KHIEN_TRACH' | 'CANH_CAO' | 'HA_BAC_LUONG' | 'GIANG_CHUC' | 'CACH_CHUC' | 'BUOC_THOI_VIEC' | 'KHAI_TRU';

  @IsOptional()
  @IsIn(['DANG', 'HANH_CHINH'])
  system?: 'DANG' | 'HANH_CHINH';

  @IsOptional()
  @IsIn(['CONG_VU', 'SUY_THOAI', 'KHAC'])
  reason?: 'CONG_VU' | 'SUY_THOAI' | 'KHAC';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
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
  /** Đơn vị có bộ trục riêng (ADR-052); bỏ trống hoặc null là bộ mặc định. */
  @IsOptional()
  @IsUUID()
  unitId?: string | null;

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

export class SimulateTaskDto {
  @IsUUID()
  taskId: string;

  @IsOptional()
  @IsInt()
  completedQuantity?: number;

  @IsOptional()
  @IsInt()
  lateCount?: number;

  @IsOptional()
  @IsInt()
  reworkCount?: number;

  @IsOptional()
  @IsInt()
  qualityLevel?: number | null;
}

export class GeneralSectionDto {
  @IsString()
  @MaxLength(10)
  code: string;

  @IsString()
  @MaxLength(500)
  name: string;
}

export class GeneralItemDto {
  @IsString()
  @MaxLength(10)
  code: string;

  @IsString()
  @MaxLength(10)
  section: string;

  @IsString()
  @MaxLength(2000)
  name: string;

  @IsNumber()
  max: number;
}

export class GeneralSetDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GeneralSectionDto)
  sections: GeneralSectionDto[];

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => GeneralItemDto)
  items: GeneralItemDto[];
}

/** Phiên bản mới của bảng tiêu chí chung cá nhân, áp dụng từ một tháng (ADR-054). */
export class CreateGeneralCriteriaDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'effectiveFrom có dạng YYYY-MM' })
  effectiveFrom: string;

  @ValidateNested()
  @Type(() => GeneralSetDto)
  leader: GeneralSetDto;

  @ValidateNested()
  @Type(() => GeneralSetDto)
  staff: GeneralSetDto;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Giả định để mô phỏng điểm; không ghi vào hồ sơ. */
export class SimulateDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SimulateTaskDto)
  tasks?: SimulateTaskDto[];

  @IsOptional()
  @IsNumber()
  generalScore?: number | null;
}
