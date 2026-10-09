/** Giao diện công khai của mô-đun catalog: các mô-đun khác chỉ import từ đây. */
export { CatalogModule } from './catalog.module.js';
export { CatalogService } from './application/catalog.service.js';
export type { CatalogItemView, CatalogScope, CatalogVersionView, VersionStatus } from './application/catalog.model.js';
