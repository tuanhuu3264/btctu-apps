import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { SecurityModule } from '../security/index.js';
import { AssignmentService } from './application/assignment.service.js';
import { OrgExportService } from './application/org-export.service.js';
import { OrgImportService } from './application/org-import.service.js';
import { OrgQueryService } from './application/org-query.service.js';
import { AssignmentRepository, PersonRepository, PositionRepository } from './application/org.ports.js';
import { PersonService } from './application/person.service.js';
import { PositionService } from './application/position.service.js';
import { UnitRepository } from './application/unit.repository.js';
import { UnitService } from './application/unit.service.js';
import { AssignmentEntity, JobPositionEntity, PersonEntity } from './data-access/org.entities.js';
import {
  TypeOrmAssignmentRepository,
  TypeOrmPersonRepository,
  TypeOrmPositionRepository,
} from './data-access/typeorm-org.repositories.js';
import { TypeOrmUnitRepository } from './data-access/typeorm-unit.repository.js';
import { UnitEntity } from './data-access/unit.entity.js';
import {
  AssignmentController,
  OrgController,
  PersonController,
  PositionController,
} from './presentation/org.controllers.js';
import { UnitController } from './presentation/unit.controller.js';

/** Đơn vị, cán bộ, vị trí việc làm, phân công theo thời gian (ADR-009, ADR-012). */
@Module({
  imports: [TypeOrmModule.forFeature([UnitEntity, PersonEntity, JobPositionEntity, AssignmentEntity]), SecurityModule],
  controllers: [UnitController, PersonController, PositionController, AssignmentController, OrgController],
  providers: [
    UnitService,
    PersonService,
    PositionService,
    AssignmentService,
    OrgQueryService,
    OrgImportService,
    OrgExportService,
    { provide: Clock, useClass: SystemClock },
    { provide: UnitRepository, useClass: TypeOrmUnitRepository },
    { provide: PersonRepository, useClass: TypeOrmPersonRepository },
    { provide: PositionRepository, useClass: TypeOrmPositionRepository },
    { provide: AssignmentRepository, useClass: TypeOrmAssignmentRepository },
  ],
  exports: [UnitService, PersonService, PositionService, AssignmentService, OrgQueryService, OrgImportService],
})
export class OrganizationModule {}
