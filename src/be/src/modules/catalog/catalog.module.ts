import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { OrganizationModule } from '../organization/index.js';
import { SecurityModule } from '../security/index.js';
import { CatalogImportService } from './application/catalog-import.service.js';
import { CatalogGroupRepository, CatalogItemRepository, CatalogScopeRepository, CatalogTaskRepository, CatalogVersionRepository, OrgDirectory } from './application/catalog.ports.js';
import { CatalogService } from './application/catalog.service.js';
import { CatalogGroupEntity, CatalogItemEntity, CatalogItemScopeEntity, CatalogTaskEntity, CatalogVersionEntity } from './data-access/catalog.entities.js';
import { OrganizationDirectoryAdapter } from './data-access/org-directory.js';
import {
  TypeOrmCatalogGroupRepository,
  TypeOrmCatalogItemRepository,
  TypeOrmCatalogScopeRepository,
  TypeOrmCatalogTaskRepository,
  TypeOrmCatalogVersionRepository,
} from './data-access/typeorm-catalog.repositories.js';
import { CatalogController } from './presentation/catalog.controller.js';

/** Danh mục sản phẩm công việc chuẩn: phiên bản, phê duyệt, hệ số quy đổi (ADR-013). */
@Module({
  imports: [TypeOrmModule.forFeature([CatalogGroupEntity, CatalogVersionEntity, CatalogTaskEntity, CatalogItemEntity, CatalogItemScopeEntity]), SecurityModule, OrganizationModule],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    CatalogImportService,
    { provide: Clock, useClass: SystemClock },
    { provide: CatalogGroupRepository, useClass: TypeOrmCatalogGroupRepository },
    { provide: CatalogVersionRepository, useClass: TypeOrmCatalogVersionRepository },
    { provide: CatalogTaskRepository, useClass: TypeOrmCatalogTaskRepository },
    { provide: CatalogItemRepository, useClass: TypeOrmCatalogItemRepository },
    { provide: CatalogScopeRepository, useClass: TypeOrmCatalogScopeRepository },
    { provide: OrgDirectory, useClass: OrganizationDirectoryAdapter },
  ],
  exports: [CatalogService, CatalogImportService],
})
export class CatalogModule {}
