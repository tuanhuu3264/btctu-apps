import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../common/clock.js';
import { EvaluationModule } from '../evaluation/index.js';
import { OrganizationModule } from '../organization/index.js';
import { SecurityModule } from '../security/index.js';
import { EvaluationSource, OrgLookup, ReportRenderer, UnitEvaluationSource } from './application/report.ports.js';
import { ReportService } from './application/report.service.js';
import { EvaluationSourceAdapter, OrgLookupAdapter, UnitEvaluationSourceAdapter } from './data-access/adapters.js';
import { FileReportRenderer } from './data-access/file-report-renderer.js';
import { ReportController } from './presentation/report.controller.js';

/** Dashboard, thống kê, xuất Excel/PDF, dự thảo điền mẫu. Chỉ đọc, không có bảng riêng (ADR-015). */
@Module({
  imports: [SecurityModule, EvaluationModule, OrganizationModule],
  controllers: [ReportController],
  providers: [
    ReportService,
    { provide: Clock, useClass: SystemClock },
    { provide: EvaluationSource, useClass: EvaluationSourceAdapter },
    { provide: UnitEvaluationSource, useClass: UnitEvaluationSourceAdapter },
    { provide: OrgLookup, useClass: OrgLookupAdapter },
    { provide: ReportRenderer, useClass: FileReportRenderer },
  ],
  exports: [ReportService],
})
export class ReportingModule {}
