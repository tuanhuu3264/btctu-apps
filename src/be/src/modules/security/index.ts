/** Giao diện công khai của mô-đun security: các mô-đun khác chỉ import từ đây. */
export { SecurityModule } from './security.module.js';
export { AccountService } from './application/account.service.js';
export { AuditService } from './application/audit.service.js';
export { AuthorizationService } from './application/authorization.service.js';
export { RecipientService } from './application/recipient.service.js';
export { RoleService } from './application/role.service.js';
export { ROLES } from './application/authorization.model.js';
export type { Permission, Role } from './application/authorization.model.js';
export type { CurrentAccount as CurrentAccountModel } from './application/security.model.js';
export { Public } from './presentation/public.decorator.js';
export { Authenticated, RequirePermission } from './presentation/require-permission.decorator.js';
export { CurrentAccount } from './presentation/current-account.decorator.js';
