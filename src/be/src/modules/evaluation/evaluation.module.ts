import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { CatalogModule } from '../catalog/index.js';
import { OrganizationModule } from '../organization/index.js';
import { SecurityModule } from '../security/index.js';
import { TaskingModule } from '../tasking/index.js';
import { CatalogDirectory, EvaluationRepository, OrgDirectory, PeriodRepository, PeriodWorkSource, TaskRepository } from './application/evaluation.ports.js';
import { EvaluationService } from './application/evaluation.service.js';
import { CatalogDirectoryAdapter, OrganizationDirectoryAdapter } from './data-access/directories.js';
import { TaskingWorkSourceAdapter } from './data-access/work-source.js';
import { EvaluationEntity, EvaluationPeriodEntity, EvaluationTaskEntity } from './data-access/evaluation.entities.js';
import {
  TypeOrmEvaluationRepository,
  TypeOrmPeriodRepository,
  TypeOrmTaskRepository,
} from './data-access/typeorm-evaluation.repositories.js';
import { EvaluationController } from './presentation/evaluation.controller.js';

/** Kỳ đánh giá, hồ sơ, chỉ tiêu, luồng tự chấm, thẩm định, phê duyệt (ADR-014). */
@Module({
  imports: [
    TypeOrmModule.forFeature([EvaluationPeriodEntity, EvaluationEntity, EvaluationTaskEntity]),
    SecurityModule,
    OrganizationModule,
    CatalogModule,
    TaskingModule,
  ],
  controllers: [EvaluationController],
  providers: [
    EvaluationService,
    { provide: Clock, useClass: SystemClock },
    { provide: PeriodRepository, useClass: TypeOrmPeriodRepository },
    { provide: EvaluationRepository, useClass: TypeOrmEvaluationRepository },
    { provide: TaskRepository, useClass: TypeOrmTaskRepository },
    { provide: OrgDirectory, useClass: OrganizationDirectoryAdapter },
    { provide: CatalogDirectory, useClass: CatalogDirectoryAdapter },
    { provide: PeriodWorkSource, useClass: TaskingWorkSourceAdapter },
  ],
  exports: [EvaluationService],
})
export class EvaluationModule {}
