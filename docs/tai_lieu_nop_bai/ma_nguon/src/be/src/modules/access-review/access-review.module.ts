import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { OrganizationModule } from '../organization/index.js';
import { SecurityModule } from '../security/index.js';
import { AccessReviewService } from './application/access-review.service.js';
import { AccessReviewRepository, ReviewExporter, ReviewOrgDirectory, RoleSource } from './application/access-review.ports.js';
import { AccessReviewEntity, AccessReviewItemEntity } from './data-access/access-review.entities.js';
import { OrganizationReviewDirectory, SecurityRoleSource } from './data-access/directories.js';
import { ExcelReviewExporter } from './data-access/excel-review-exporter.js';
import { TypeOrmAccessReviewRepository } from './data-access/typeorm-access-review.repository.js';
import { AccessReviewController } from './presentation/access-review.controller.js';

/** Rà soát quyền định kỳ theo quý (ADR-044). Đứng riêng vì cần cả security (vai trò) lẫn organization (lãnh đạo phụ trách). */
@Module({
  imports: [TypeOrmModule.forFeature([AccessReviewEntity, AccessReviewItemEntity]), SecurityModule, OrganizationModule],
  controllers: [AccessReviewController],
  providers: [
    AccessReviewService,
    { provide: Clock, useClass: SystemClock },
    { provide: AccessReviewRepository, useClass: TypeOrmAccessReviewRepository },
    { provide: RoleSource, useClass: SecurityRoleSource },
    { provide: ReviewOrgDirectory, useClass: OrganizationReviewDirectory },
    { provide: ReviewExporter, useClass: ExcelReviewExporter },
  ],
  exports: [AccessReviewService],
})
export class AccessReviewModule {}
