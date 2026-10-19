import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentAccount, RequirePermission } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import { fileResponseHeaders, MAX_FILE_BYTES } from '../../tasking/index.js';
import { MAX_FILES_PER_POST } from '../application/document.model.js';
import type { CategoryModel } from '../application/document.model.js';
import { DocumentService } from '../application/document.service.js';
import type { CategoryView, PostSearchResult, PostView } from '../application/document.service.js';
import { CategoryDto, PostQueryDto, PublishDto, UpdatePostDto } from './document.dto.js';

/** Phần của tệp do multer đọc (lưu trong bộ nhớ) mà controller dùng. */
interface UploadedMulterFile {
  originalname: string;
  size: number;
  buffer: Buffer;
}

@Controller('documents')
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  @Get('categories')
  @RequirePermission('document:read')
  listCategories(): Promise<CategoryView[]> {
    return this.documents.listCategories();
  }

  @Post('categories')
  @RequirePermission('document:manage')
  createCategory(@Body() dto: CategoryDto): Promise<CategoryModel> {
    return this.documents.createCategory(dto);
  }

  @Patch('categories/:id')
  @RequirePermission('document:manage')
  updateCategory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoryDto): Promise<CategoryModel> {
    return this.documents.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequirePermission('document:manage')
  deleteCategory(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.documents.deleteCategory(id);
  }

  @Get('posts')
  @RequirePermission('document:read')
  searchPosts(@Query() query: PostQueryDto): Promise<PostSearchResult> {
    return this.documents.search(query);
  }

  /** Đăng bài (multipart): các trường categoryId, title, summary và tối đa 10 tệp ở trường `files`. */
  @Post('posts')
  @RequirePermission('document:manage')
  @UseInterceptors(FilesInterceptor('files', MAX_FILES_PER_POST, { limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_POST } }))
  publish(@CurrentAccount() actor: CurrentAccountModel, @Body() dto: PublishDto, @UploadedFiles() files: UploadedMulterFile[] | undefined): Promise<PostView> {
    const uploads = (files ?? []).map((f) => ({
      // multer đọc tên tệp theo latin1; đổi lại UTF-8 để giữ tiếng Việt.
      originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      size: f.size,
      buffer: f.buffer,
    }));
    return this.documents.publish(actor, dto, uploads);
  }

  @Get('posts/:id')
  @RequirePermission('document:read')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PostView> {
    return this.documents.get(id);
  }

  @Patch('posts/:id')
  @RequirePermission('document:manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePostDto): Promise<PostView> {
    return this.documents.update(id, dto);
  }

  /** Gỡ bài khỏi bản tin (ẩn, vẫn lưu). */
  @Delete('posts/:id')
  @HttpCode(204)
  @RequirePermission('document:manage')
  withdraw(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.documents.withdraw(id);
  }

  /** Tải tệp về qua máy chủ (không công khai), mặc định là tệp đính kèm; `?inline=1` để xem trực tiếp pdf, ảnh, văn bản (ADR-026). */
  @Get('posts/:id/files/:fileId')
  @RequirePermission('document:read')
  async download(
    @CurrentAccount() actor: CurrentAccountModel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('inline') inline: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { file, data } = await this.documents.download(actor, id, fileId);
    res.set(fileResponseHeaders(file, data.length, inline === '1', process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000'));
    return new StreamableFile(data);
  }
}
