import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { AccessReviewModule } from './modules/access-review/index.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { DocumentsModule } from './modules/documents/index.js';
import { EvaluationModule } from './modules/evaluation/evaluation.module.js';
import { IntegrationModule } from './modules/integration/integration.module.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { MeetingModule } from './modules/meeting/index.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { ProjectModule } from './modules/project/index.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { ScoringModule } from './modules/scoring/scoring.module.js';
import { TaskingModule } from './modules/tasking/tasking.module.js';
import { SecurityModule } from './modules/security/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    OrganizationModule,
    CatalogModule,
    EvaluationModule,
    TaskingModule,
    ProjectModule,
    MeetingModule,
    DocumentsModule,
    NotificationsModule,
    ScoringModule,
    ReportingModule,
    SecurityModule,
    AccessReviewModule,
    IntegrationModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
