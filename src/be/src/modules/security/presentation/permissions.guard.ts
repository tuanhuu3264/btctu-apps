import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../application/audit.service.js';
import { AuthorizationService } from '../application/authorization.service.js';
import type { Permission } from '../application/authorization.model.js';
import type { AuthenticatedRequest } from './current-account.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { AUTHENTICATED_ONLY_KEY, PERMISSIONS_KEY } from './require-permission.decorator.js';

/**
 * Chạy sau AuthGuard. Mặc định từ chối: route phải khai báo rõ cách truy cập
 * (@Public, @Authenticated hoặc @RequirePermission), tránh quên bảo vệ route mới.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets);
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, targets);
    if (!required && !authenticatedOnly) {
      throw new ForbiddenException('Route chưa khai báo quyền truy cập');
    }
    if (!required) return true;

    const account = context.switchToHttp().getRequest<AuthenticatedRequest>().account;
    if (!account) throw new ForbiddenException('Không xác định được người dùng');

    const granted = await this.authorization.permissionsOf(account.id);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length > 0) {
      const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
      await this.audit.record({
        action: 'access.denied',
        outcome: 'DENIED',
        details: { method: request.method, path: request.originalUrl?.split('?')[0], missing },
      });
      throw new ForbiddenException('Không đủ quyền thực hiện thao tác này');
    }
    return true;
  }
}
