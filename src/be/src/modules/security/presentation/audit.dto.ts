import { Type } from 'class-transformer';
import { IsInt, IsNumberString, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AuditQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

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
