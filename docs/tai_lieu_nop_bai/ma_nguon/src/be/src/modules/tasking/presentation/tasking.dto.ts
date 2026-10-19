import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ASSIGNMENT_STATES, MAX_COMMENT_LENGTH, MAX_CONSULTANTS, MAX_CONTENT_LENGTH, REPORT_KINDS } from '../application/tasking.model.js';
import { RECURRING_FREQUENCIES } from '../application/recurring.model.js';
import type { RecurringFrequency } from '../application/recurring.model.js';
import type { AssignmentSource, AssignmentState, CommentKind, PeriodMode, ReportKind } from '../application/tasking.model.js';
import type { ListScope, SearchScope, WorkKind } from '../application/tasking.service.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateTaskDto {
  @IsUUID()
  assigneePersonId: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class AssignDto {
  @IsUUID()
  taskId: string;

  /** Vị trí người nhận giữ mà việc thuộc về; bắt buộc khi người nhận kiêm nhiệm (ADR-047). */
  @IsOptional()
  @IsUUID()
  positionId?: string;

  /** CATALOG (mặc định) hoặc AD_HOC: việc đột xuất, phát sinh ngoài kế hoạch (ADR-046). */
  @IsOptional()
  @IsIn(['CATALOG', 'AD_HOC'])
  source?: AssignmentSource;

  /** Bắt buộc với việc trong danh mục. */
  @IsOptional()
  @Matches(/^[A-Z]\.\d{3}$/, { message: 'catalogItemCode có dạng A.001' })
  catalogItemCode?: string;

  /** Tên việc đột xuất (bắt buộc khi source = AD_HOC). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /** Mức độ khó 1 đến 4 của việc đột xuất (bắt buộc khi source = AD_HOC). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  difficulty?: number;

  @IsInt()
  plannedQuantity: number;

  @Matches(DATE, { message: 'dueDate có dạng YYYY-MM-DD' })
  dueDate: string;

  @IsIn(['AUTO', 'MANUAL'])
  periodMode: PeriodMode;

  /** Bắt buộc và chỉ có tác dụng với chế độ MANUAL. */
  @IsOptional()
  @IsArray()
  @IsIn(REPORT_KINDS, { each: true })
  reportKinds?: ReportKind[];

  /** Nội dung việc. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  note?: string;

  /** Người duyệt (cc): một cấp trên của người nhận. */
  @IsOptional()
  @IsUUID()
  approverPersonId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONSULTANTS)
  @IsUUID('all', { each: true })
  consultantPersonIds?: string[];

  /** Mã kết quả then chốt (KR1...) trong OKR của người nhận (ADR-034). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  keyResult?: string;
}

/** Sửa nội dung, người duyệt, người tham vấn của việc còn mở. `approverPersonId: null` là quay về cấp trên trực tiếp. */
export class UpdateAssignmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  approverPersonId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONSULTANTS)
  @IsUUID('all', { each: true })
  consultantPersonIds?: string[];

  /** Mã kết quả then chốt; `null` là bỏ gắn (ADR-034). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  keyResult?: string | null;
}

export class ExportAssignmentsQueryDto {
  @IsIn(['xlsx', 'pdf'])
  format: 'xlsx' | 'pdf';

  @IsOptional()
  @IsIn(['mine', 'team', 'all', 'consulted', 'approving', 'assigned'])
  scope?: SearchScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsIn(ASSIGNMENT_STATES, { each: true })
  states?: AssignmentState[];

  @IsOptional()
  @IsUUID()
  assigneePersonId?: string;

  @IsOptional()
  @IsIn(['CATALOG', 'AD_HOC', 'RECURRING'])
  kind?: WorkKind;

  @IsOptional()
  @Matches(DATE)
  dueFrom?: string;

  @IsOptional()
  @Matches(DATE)
  dueTo?: string;

  @IsOptional()
  @Matches(DATE)
  createdFrom?: string;

  @IsOptional()
  @Matches(DATE)
  createdTo?: string;

  @IsOptional()
  @IsIn(['due', 'dueDesc', 'created'])
  sort?: 'due' | 'dueDesc' | 'created';
}

export class SearchQueryDto {
  @IsOptional()
  @IsIn(['mine', 'team', 'all', 'consulted', 'approving', 'assigned'])
  scope?: SearchScope;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Nhiều trạng thái cách nhau bằng dấu phẩy: IN_PROGRESS,PENDING_CONFIRM,OVERDUE,DONE,CANCELLED. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsIn(ASSIGNMENT_STATES, { each: true })
  states?: AssignmentState[];

  @IsOptional()
  @IsUUID()
  assigneePersonId?: string;

  @IsOptional()
  @IsIn(['CATALOG', 'AD_HOC', 'RECURRING'])
  kind?: WorkKind;

  @IsOptional()
  @Matches(DATE)
  dueFrom?: string;

  @IsOptional()
  @Matches(DATE)
  dueTo?: string;

  @IsOptional()
  @Matches(DATE)
  createdFrom?: string;

  @IsOptional()
  @Matches(DATE)
  createdTo?: string;

  @IsOptional()
  @IsIn(['due', 'dueDesc', 'created'])
  sort?: 'due' | 'dueDesc' | 'created';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CommentDto {
  @IsString()
  @MaxLength(MAX_COMMENT_LENGTH)
  body: string;

  @IsOptional()
  @IsIn(['MESSAGE', 'OPINION'])
  kind?: CommentKind;
}

export class UploadDto {
  @IsOptional()
  @IsUUID()
  commentId?: string;
}

export class ListQueryDto {
  @IsOptional()
  @IsIn(['mine', 'team', 'all'])
  scope?: ListScope;
}

export class ReportDto {
  @IsInt()
  quantity: number;

  @Matches(DATE, { message: 'completedOn có dạng YYYY-MM-DD' })
  completedOn: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidence?: string;
}

export class DecisionDto {
  @IsIn(['CONFIRM', 'REJECT'])
  decision: 'CONFIRM' | 'REJECT';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** Bắt buộc khi từ chối: có phải sai sót lớn về nội dung (bị trừ 25% điểm chất lượng) hay không. */
  @IsOptional()
  @IsBoolean()
  majorError?: boolean;

  /** Nguyên nhân khách quan khiến lần này bị tính chậm hoặc chưa đạt; có thì miễn trừ ngay khi duyệt (ADR-056). */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  objectiveReason?: string;
}

export class WaiverDto {
  /** Nguyên nhân khách quan và căn cứ xác nhận, ít nhất 10 ký tự. */
  @IsString()
  @MaxLength(2000)
  reason: string;
}

export class RevokeWaiverDto {
  @IsString()
  @MaxLength(2000)
  note: string;
}

export class FileSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsUUID()
  uploaderPersonId?: string;

  @IsOptional()
  @Matches(DATE, { message: 'from có dạng YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DATE, { message: 'to có dạng YYYY-MM-DD' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Cán bộ đề xuất việc đột xuất cho chính mình (ADR-046). */
export class ProposeDto {
  /** Vị trí mà việc thuộc về; bỏ trống thì lấy vị trí chính (ADR-047). */
  @IsOptional()
  @IsUUID()
  positionId?: string;

  /** Nhiệm vụ của chính mình; bỏ trống thì vào nhiệm vụ "Việc đột xuất". */
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsInt()
  plannedQuantity: number;

  @Matches(DATE, { message: 'dueDate có dạng YYYY-MM-DD' })
  dueDate: string;

  /** Mức độ khó đề xuất 1 đến 4; người duyệt quyết định mức cuối. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  difficulty?: number;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  note?: string;
}

export class ApproveProposalDto {
  @IsInt()
  @Min(1)
  @Max(4)
  difficulty: number;

  @IsOptional()
  @IsInt()
  plannedQuantity?: number;

  @IsOptional()
  @Matches(DATE, { message: 'dueDate có dạng YYYY-MM-DD' })
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  note?: string;
}

export class RejectProposalDto {
  @IsString()
  @MaxLength(1000)
  reason: string;
}

export class CreateRecurringDto {
  @IsUUID()
  taskId: string;

  @IsOptional()
  @IsIn(['CATALOG', 'AD_HOC'])
  source?: AssignmentSource;

  @IsOptional()
  @Matches(/^[A-Z]\.\d{3}$/, { message: 'catalogItemCode có dạng A.001' })
  catalogItemCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  difficulty?: number;

  @IsInt()
  plannedQuantity: number;

  @IsIn(RECURRING_FREQUENCIES)
  frequency: RecurringFrequency;

  @Matches(DATE, { message: 'startDate có dạng YYYY-MM-DD' })
  startDate: string;

  @IsOptional()
  @Matches(DATE, { message: 'endDate có dạng YYYY-MM-DD' })
  endDate?: string;

  /** Hạn = ngày lặp + số ngày này, 0 đến 366. */
  @IsInt()
  @Min(0)
  @Max(366)
  dueAfterDays: number;

  @IsOptional()
  @IsIn(['AUTO', 'MANUAL'])
  periodMode?: PeriodMode;

  @IsOptional()
  @IsArray()
  @IsIn(REPORT_KINDS, { each: true })
  reportKinds?: ReportKind[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  note?: string;

  @IsOptional()
  @IsUUID()
  approverPersonId?: string;
}

/** Chỉ áp dụng cho các lần lặp sinh sau này. `null` ở `endDate` là bỏ ngày kết thúc. */
export class UpdateRecurringDto {
  @IsOptional()
  @IsInt()
  plannedQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(366)
  dueAfterDays?: number;

  @IsOptional()
  @Matches(DATE, { message: 'endDate có dạng YYYY-MM-DD' })
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  note?: string | null;

  @IsOptional()
  @IsUUID()
  approverPersonId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
