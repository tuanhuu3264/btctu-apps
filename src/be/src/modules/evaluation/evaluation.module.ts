import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { CatalogModule } from '../catalog/index.js';
import { OrganizationModule } from '../organization/index.js';
import { SecurityModule } from '../security/index.js';
import { TaskingModule } from '../tasking/index.js';
import { CatalogDirectory, EvaluationRepository, HeadedUnitRatingSource, OrgDirectory, PeriodRepository, PeriodWorkSource, TaskRepository, UnitCompletionSource } from './application/evaluation.ports.js';
import { EvaluationService } from './application/evaluation.service.js';
import { CatalogDirectoryAdapter, OrganizationDirectoryAdapter, OrganizationUnitDirectoryAdapter, UnitCompletionAdapter, UnitRatingAdapter } from './data-access/directories.js';
import { RatingEventRepository } from './application/rating-events.js';
import { RatingEventService } from './application/rating-event.service.js';
import { TaskingWorkSourceAdapter } from './data-access/work-source.js';
import {
  EvaluationEntity,
  EvaluationRevocationEntity,
  EvaluationPeriodEntity,
  EvaluationTaskEntity,
  GeneralCriteriaVersionEntity,
  RatingEventEntity,
  UnitAxisEntity,
  UnitComplaintEntity,
  UnitEvaluationEntity,
  LeaveRecordEntity,
} from './data-access/evaluation.entities.js';
import {
  TypeOrmEvaluationRepository,
  TypeOrmGeneralCriteriaRepository,
  TypeOrmRatingEventRepository,
  TypeOrmLeaveRepository,
  TypeOrmPeriodRepository,
  TypeOrmTaskRepository,
  TypeOrmUnitAxisRepository,
  TypeOrmUnitComplaintRepository,
  TypeOrmUnitEvaluationRepository,
} from './data-access/typeorm-evaluation.repositories.js';
import { UnitAxisRepository, UnitDirectory, UnitEvaluationRepository } from './application/unit-evaluation.ports.js';
import { UnitEvaluationService } from './application/unit-evaluation.service.js';
import { LeaveRepository } from './application/leave.js';
import { UnitComplaintService } from './application/unit-complaint.service.js';
import { UnitComplaintRepository } from './application/unit-complaint.js';
import { EvaluationController } from './presentation/evaluation.controller.js';
import { UnitEvaluationController } from './presentation/unit-evaluation.controller.js';
import { UnitComplaintController } from './presentation/unit-complaint.controller.js';
import { GeneralCriteriaRepository } from './application/general-criteria.js';
import { GeneralCriteriaService } from './application/general-criteria.service.js';
import { GeneralCriteriaController } from './presentation/general-criteria.controller.js';

/** Kỳ đánh giá, hồ sơ, chỉ tiêu, luồng tự chấm, thẩm định, phê duyệt (ADR-014); đánh giá tập thể theo năm (ADR-030). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      EvaluationPeriodEntity,
      EvaluationEntity,
      EvaluationRevocationEntity,
      EvaluationTaskEntity,
      UnitEvaluationEntity,
      UnitAxisEntity,
      UnitComplaintEntity,
      LeaveRecordEntity,
      GeneralCriteriaVersionEntity,
      RatingEventEntity,
    ]),
    SecurityModule,
    OrganizationModule,
    CatalogModule,
    TaskingModule,
  ],
  controllers: [EvaluationController, UnitEvaluationController, UnitComplaintController, GeneralCriteriaController],
  providers: [
    EvaluationService,
    GeneralCriteriaService,
    RatingEventService,
    { provide: GeneralCriteriaRepository, useClass: TypeOrmGeneralCriteriaRepository },
    { provide: RatingEventRepository, useClass: TypeOrmRatingEventRepository },
    { provide: UnitCompletionSource, useClass: UnitCompletionAdapter },
    UnitEvaluationService,
    UnitComplaintService,
    { provide: Clock, useClass: SystemClock },
    { provide: PeriodRepository, useClass: TypeOrmPeriodRepository },
    { provide: EvaluationRepository, useClass: TypeOrmEvaluationRepository },
    { provide: TaskRepository, useClass: TypeOrmTaskRepository },
    { provide: UnitEvaluationRepository, useClass: TypeOrmUnitEvaluationRepository },
    { provide: UnitAxisRepository, useClass: TypeOrmUnitAxisRepository },
    { provide: UnitComplaintRepository, useClass: TypeOrmUnitComplaintRepository },
    { provide: LeaveRepository, useClass: TypeOrmLeaveRepository },
    { provide: UnitDirectory, useClass: OrganizationUnitDirectoryAdapter },
    { provide: HeadedUnitRatingSource, useClass: UnitRatingAdapter },
    { provide: OrgDirectory, useClass: OrganizationDirectoryAdapter },
    { provide: CatalogDirectory, useClass: CatalogDirectoryAdapter },
    { provide: PeriodWorkSource, useClass: TaskingWorkSourceAdapter },
  ],
  exports: [EvaluationService, UnitEvaluationService],
})
export class EvaluationModule {}
