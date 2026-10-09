import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityModule } from '../security/index.js';
import { FileStorage, S3FileStorage } from '../tasking/index.js';
import { DocumentService } from './application/document.service.js';
import { CategoryRepository, PostFileRepository, PostRepository } from './application/document.ports.js';
import { DocumentCategoryEntity, DocumentFileEntity, DocumentPostEntity } from './data-access/document.entities.js';
import { TypeOrmCategoryRepository, TypeOrmPostFileRepository, TypeOrmPostRepository } from './data-access/typeorm-document.repositories.js';
import { DocumentController } from './presentation/document.controller.js';

/** Danh mục tài liệu và bản tin tài liệu (ADR-025). Dùng chung kho tệp S3 với tasking. */
@Module({
  imports: [TypeOrmModule.forFeature([DocumentCategoryEntity, DocumentPostEntity, DocumentFileEntity]), SecurityModule],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    { provide: CategoryRepository, useClass: TypeOrmCategoryRepository },
    { provide: PostRepository, useClass: TypeOrmPostRepository },
    { provide: PostFileRepository, useClass: TypeOrmPostFileRepository },
    { provide: FileStorage, useClass: S3FileStorage },
  ],
})
export class DocumentsModule {}
