import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { MAX_CATEGORY_DESCRIPTION_LENGTH, MAX_CATEGORY_NAME_LENGTH, MAX_SUMMARY_LENGTH, MAX_TITLE_LENGTH } from '../application/document.model.js';

export class CategoryDto {
  @IsString()
  @MaxLength(MAX_CATEGORY_NAME_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CATEGORY_DESCRIPTION_LENGTH)
  description?: string;
}

/** Đăng bài: gửi dạng multipart, các trường chữ cùng các tệp ở trường `files`. */
export class PublishDto {
  @IsUUID()
  categoryId: string;

  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SUMMARY_LENGTH)
  summary?: string;
}

export class UpdatePostDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_SUMMARY_LENGTH)
  summary?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class PostQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

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
