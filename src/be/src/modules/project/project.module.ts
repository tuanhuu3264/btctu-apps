import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { OrganizationModule } from '../organization/index.js';
import { SecurityModule } from '../security/index.js';
import { FileStorage, S3FileStorage, TaskingModule } from '../tasking/index.js';
import { MemberRepository, MilestoneRepository, ProjectAttachmentRepository, ProjectOrgDirectory, ProjectRepository, ProjectWorkDirectory } from './application/project.ports.js';
import { ProjectService } from './application/project.service.js';
import { OrganizationDirectoryAdapter, TaskingDirectoryAdapter } from './data-access/directories.js';
import { ProjectAttachmentEntity, ProjectEntity, ProjectMemberEntity, ProjectMilestoneEntity } from './data-access/project.entities.js';
import { TypeOrmMemberRepository, TypeOrmMilestoneRepository, TypeOrmProjectAttachmentRepository, TypeOrmProjectRepository } from './data-access/typeorm-project.repositories.js';
import { ProjectController } from './presentation/project.controller.js';

/** Đề án, dự án (ADR-050). Dùng việc được giao của tasking (một chiều) và kho tệp S3 chung. */
@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, ProjectMemberEntity, ProjectMilestoneEntity, ProjectAttachmentEntity]), SecurityModule, OrganizationModule, TaskingModule],
  controllers: [ProjectController],
  providers: [
    ProjectService,
    { provide: Clock, useClass: SystemClock },
    { provide: ProjectRepository, useClass: TypeOrmProjectRepository },
    { provide: MemberRepository, useClass: TypeOrmMemberRepository },
    { provide: MilestoneRepository, useClass: TypeOrmMilestoneRepository },
    { provide: ProjectAttachmentRepository, useClass: TypeOrmProjectAttachmentRepository },
    { provide: ProjectOrgDirectory, useClass: OrganizationDirectoryAdapter },
    { provide: ProjectWorkDirectory, useClass: TaskingDirectoryAdapter },
    { provide: FileStorage, useClass: S3FileStorage },
  ],
  exports: [ProjectService],
})
export class ProjectModule {}
