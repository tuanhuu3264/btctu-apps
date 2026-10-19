/** Giao diện công khai của mô-đun organization: các mô-đun khác chỉ import từ đây. */
export { OrganizationModule } from './organization.module.js';
export { OrgQueryService } from './application/org-query.service.js';
export { PersonService } from './application/person.service.js';
export { keyResultLabel, parseOkr } from './application/okr-parser.js';
export type { KeyResult, ParsedOkr } from './application/okr-parser.js';
export type { OrgLookupData, OrgSuperior } from './application/org-query.service.js';
export type { PositionModel } from './application/org.model.js';
