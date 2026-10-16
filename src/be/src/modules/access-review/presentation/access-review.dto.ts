import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { REVIEW_DECISIONS } from '../application/access-review.model.js';
import type { ReviewDecision } from '../application/access-review.model.js';

export class CreateAccessReviewDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter: number;

  /** Hạn xác nhận, dạng 2026-10-31. Bỏ trống thì 14 ngày kể từ hôm nay. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dueDate có dạng YYYY-MM-DD' })
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class DecideItemDto {
  @IsIn(REVIEW_DECISIONS)
  decision: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
