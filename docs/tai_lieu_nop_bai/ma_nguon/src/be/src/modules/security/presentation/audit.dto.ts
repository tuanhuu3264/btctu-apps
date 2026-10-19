import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { AUDIT_MODULES, AUDIT_TYPES } from '../application/audit-classify.js';
import type { AuditModule, AuditType } from '../application/audit-classify.js';
import { AUDIT_OUTCOMES } from '../application/audit.model.js';
import type { AuditOutcome } from '../application/audit.model.js';

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  username?: string;

  @IsOptional()
  @IsIn(AUDIT_OUTCOMES)
  outcome?: AuditOutcome;

  @IsOptional()
  @IsIn(AUDIT_MODULES)
  module?: AuditModule;

  @IsOptional()
  @IsIn(AUDIT_TYPES)
  type?: AuditType;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  targetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetId?: string;

  /** Từ thời điểm (ISO 8601, ví dụ 2026-10-01 hoặc 2026-10-01T08:00:00+07:00). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Đến trước thời điểm (ISO 8601). */
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** Phân trang lùi: chỉ lấy bản ghi có id nhỏ hơn giá trị này. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(18)
  beforeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Phân trang lịch sử của một đối tượng. */
export class EntityHistoryQueryDto {
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(18)
  beforeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Bộ lọc nhật ký (như danh sách; `beforeId` và `limit` được bỏ qua) kèm định dạng tệp xuất. */
export class AuditExportQueryDto extends AuditQueryDto {
  @IsIn(['xlsx', 'pdf'])
  format: 'xlsx' | 'pdf';
}
