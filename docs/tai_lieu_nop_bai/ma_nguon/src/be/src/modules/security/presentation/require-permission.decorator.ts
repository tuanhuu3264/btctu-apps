import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../application/authorization.model.js';

export const PERMISSIONS_KEY = 'requiredPermissions';
export const AUTHENTICATED_ONLY_KEY = 'authenticatedOnly';

/** Route cần đủ tất cả các quyền nêu ra. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Route chỉ cần đã đăng nhập, không cần quyền cụ thể. Phải khai báo rõ: route không có
 * @Public, @RequirePermission hay @Authenticated bị từ chối (ADR-011 mục 4).
 */
export const Authenticated = () => SetMetadata(AUTHENTICATED_ONLY_KEY, true);
