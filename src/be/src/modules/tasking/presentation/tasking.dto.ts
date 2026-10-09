import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { ASSIGNMENT_STATES, MAX_COMMENT_LENGTH, MAX_CONSULTANTS, MAX_CONTENT_LENGTH, REPORT_KINDS } from '../application/tasking.model.js';
import type { AssignmentState, CommentKind, PeriodMode, ReportKind } from '../application/tasking.model.js';
import type { ListScope, SearchScope } from '../application/tasking.service.js';

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

  @Matches(/^[A-Z]\.\d{3}$/, { message: 'catalogItemCode có dạng A.001' })
  catalogItemCode: string;

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
