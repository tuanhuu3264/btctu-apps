import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateNested } from 'class-validator';
import { MEETING_STATUSES, ROOM_STATUSES } from '../application/meeting.model.js';
import type { MeetingStatus, RoomStatus } from '../application/meeting.model.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class AttendeeDto {
  @IsUUID()
  personId: string;

  @IsOptional()
  @IsIn(['REQUIRED', 'OPTIONAL'])
  role?: 'REQUIRED' | 'OPTIONAL';
}

export class CreateMeetingDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  agenda?: string | null;

  /** ISO 8601 kèm múi giờ, ví dụ 2026-10-20T08:30:00+07:00. */
  @IsString()
  @MaxLength(40)
  startAt: string;

  @IsString()
  @MaxLength(40)
  endAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  onlineLink?: string | null;

  /** Phòng họp trong danh mục; có thì địa điểm lấy theo tên phòng. */
  @IsOptional()
  @IsUUID()
  roomId?: string | null;

  /** Bỏ trống thì người tạo là chủ trì. */
  @IsOptional()
  @IsUUID()
  organizerPersonId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttendeeDto)
  attendees?: AttendeeDto[];

  @IsOptional()
  @IsUUID()
  projectId?: string | null;
}

export class UpdateMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  agenda?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  startAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  endAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  onlineLink?: string | null;

  @IsOptional()
  @IsUUID()
  roomId?: string | null;

  @IsOptional()
  @IsUUID()
  organizerPersonId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AttendeeDto)
  attendees?: AttendeeDto[];

  @IsOptional()
  @IsUUID()
  projectId?: string | null;
}

export class CheckConflictsDto {
  @IsString()
  @MaxLength(40)
  startAt: string;

  @IsString()
  @MaxLength(40)
  endAt: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  attendeePersonIds: string[];

  @IsOptional()
  @IsUUID()
  excludeMeetingId?: string;
}

export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export class RespondDto {
  @IsIn(['ACCEPTED', 'DECLINED'])
  response: 'ACCEPTED' | 'DECLINED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ActionDto {
  @IsString()
  @MaxLength(1000)
  content: string;

  @IsUUID()
  assigneePersonId: string;

  @Matches(DATE, { message: 'dueDate phải có dạng YYYY-MM-DD' })
  dueDate: string;
}

export class UpdateActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;

  @IsOptional()
  @IsUUID()
  assigneePersonId?: string;

  @IsOptional()
  @Matches(DATE, { message: 'dueDate phải có dạng YYYY-MM-DD' })
  dueDate?: string;
}

export class ConcludeDto {
  @IsString()
  @MaxLength(8000)
  conclusion: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  attendedPersonIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ActionDto)
  actions?: ActionDto[];
}

export class ConclusionDto {
  @IsString()
  @MaxLength(8000)
  conclusion: string;
}

export class MeetingQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;

  @IsOptional()
  @IsIn(['mine', 'all'])
  scope?: 'mine' | 'all';

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsIn(MEETING_STATUSES)
  status?: MeetingStatus;
}

export class CheckRoomDto {
  @IsUUID()
  roomId: string;

  @IsString()
  @MaxLength(40)
  startAt: string;

  @IsString()
  @MaxLength(40)
  endAt: string;

  @IsOptional()
  @IsUUID()
  excludeMeetingId?: string;
}

export class RoomDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsInt()
  capacity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  capacity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(ROOM_STATUSES)
  status?: RoomStatus;
}

export class RoomQueryDto {
  /** true: gồm cả phòng đã ngừng sử dụng (cho màn hình quản lý). */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeInactive?: 'true' | 'false';
}
