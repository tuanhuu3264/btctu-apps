import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { PROJECT_KINDS, PROJECT_STATUSES } from '../application/project.model.js';
import type { ProjectKind, ProjectStatus } from '../application/project.model.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MSG = 'phải có dạng YYYY-MM-DD';

export class CreateProjectDto {
  @IsIn(PROJECT_KINDS)
  kind: ProjectKind;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  objective?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string | null;

  /** Bỏ trống thì người lập là chủ trì. */
  @IsOptional()
  @IsUUID()
  ownerPersonId?: string;

  @Matches(DATE, { message: `startDate ${DATE_MSG}` })
  startDate: string;

  @Matches(DATE, { message: `endDate ${DATE_MSG}` })
  endDate: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  objective?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string | null;

  @IsOptional()
  @IsUUID()
  ownerPersonId?: string;

  @IsOptional()
  @Matches(DATE, { message: `startDate ${DATE_MSG}` })
  startDate?: string;

  @IsOptional()
  @Matches(DATE, { message: `endDate ${DATE_MSG}` })
  endDate?: string;
}

export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class CompleteProjectDto {
  @IsOptional()
  @Matches(DATE, { message: `completedOn ${DATE_MSG}` })
  completedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class MemberDto {
  @IsUUID()
  personId: string;
}

export class MilestoneDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @Matches(DATE, { message: `dueDate ${DATE_MSG}` })
  dueDate: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  weight?: number;

  @IsOptional()
  @IsUUID()
  assigneePersonId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class UpdateMilestoneDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @Matches(DATE, { message: `dueDate ${DATE_MSG}` })
  dueDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  weight?: number;

  @IsOptional()
  @IsUUID()
  assigneePersonId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class MilestoneDoneDto {
  @IsOptional()
  @Matches(DATE, { message: `completedOn ${DATE_MSG}` })
  completedOn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

export class LinkWorkDto {
  @IsUUID()
  assignmentId: string;
}

export class ProjectQueryDto {
  @IsOptional()
  @IsIn(['mine', 'team', 'all'])
  scope?: 'mine' | 'team' | 'all';

  @IsOptional()
  @IsIn(PROJECT_STATUSES)
  status?: ProjectStatus;

  @IsOptional()
  @IsIn(PROJECT_KINDS)
  kind?: ProjectKind;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class ProjectExportQueryDto extends ProjectQueryDto {
  @IsIn(['xlsx', 'pdf'])
  format: 'xlsx' | 'pdf';
}
