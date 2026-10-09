import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { CatalogModule } from '../catalog/index.js';
import { OrganizationModule } from '../organization/index.js';
import { SecurityModule } from '../security/index.js';
import { CollaborationService } from './application/collaboration.service.js';
import {
  AssignmentRepository,
  AttachmentRepository,
  CatalogDirectory,
  CommentRepository,
  ConsultantRepository,
  FileStorage,
  OrgDirectory,
  ProgressRepository,
  WorkTaskRepository,
} from './application/tasking.ports.js';
import { TaskingService } from './application/tasking.service.js';
import { CatalogDirectoryAdapter, OrganizationDirectoryAdapter } from './data-access/directories.js';
import { S3FileStorage } from './data-access/s3-file-storage.js';
import {
  WorkAssignmentEntity,
  WorkAttachmentEntity,
  WorkCommentEntity,
  WorkConsultantEntity,
  WorkProgressEntity,
  WorkTaskEntity,
} from './data-access/tasking.entities.js';
import {
  TypeOrmAssignmentRepository,
  TypeOrmAttachmentRepository,
  TypeOrmCommentRepository,
  TypeOrmConsultantRepository,
  TypeOrmProgressRepository,
  TypeOrmWorkTaskRepository,
} from './data-access/typeorm-tasking.repositories.js';
import { TaskingController } from './presentation/tasking.controller.js';

/** Giao việc, báo cáo hoàn thành, cấp trên xác nhận (ADR-016). */
@Module({
  imports: [TypeOrmModule.forFeature([WorkTaskEntity, WorkAssignmentEntity, WorkProgressEntity, WorkConsultantEntity, WorkCommentEntity, WorkAttachmentEntity]), SecurityModule, OrganizationModule, CatalogModule],
  controllers: [TaskingController],
  providers: [
    TaskingService,
    CollaborationService,
    { provide: Clock, useClass: SystemClock },
    { provide: AssignmentRepository, useClass: TypeOrmAssignmentRepository },
    { provide: ProgressRepository, useClass: TypeOrmProgressRepository },
    { provide: WorkTaskRepository, useClass: TypeOrmWorkTaskRepository },
    { provide: ConsultantRepository, useClass: TypeOrmConsultantRepository },
    { provide: CommentRepository, useClass: TypeOrmCommentRepository },
    { provide: AttachmentRepository, useClass: TypeOrmAttachmentRepository },
    { provide: FileStorage, useClass: S3FileStorage },
    { provide: OrgDirectory, useClass: OrganizationDirectoryAdapter },
    { provide: CatalogDirectory, useClass: CatalogDirectoryAdapter },
  ],
  exports: [TaskingService],
})
export class TaskingModule {}
