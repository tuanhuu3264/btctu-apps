import { CanActivate, Injectable, UnauthorizedException } from '@nestjs/common';
import { requestContext } from '../../../common/request-context.js';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SecurityConfig } from '../application/security.config.js';
import { SessionService } from '../application/session.service.js';
import type { AuthenticatedRequest } from './current-account.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/** Guard toàn cục: mọi route cần phiên hợp lệ, trừ route đánh dấu @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly config: SecurityConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[this.config.cookieName] as string | undefined;
    const account = await this.sessions.resolve(token);
    if (!account) throw new UnauthorizedException('Chưa đăng nhập hoặc phiên đã hết hạn');

    request.account = account;
    requestContext.setActor({ id: account.id, username: account.username });
    return true;
  }
}
