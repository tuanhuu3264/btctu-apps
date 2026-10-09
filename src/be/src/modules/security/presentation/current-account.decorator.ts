import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentAccount as CurrentAccountModel } from '../application/security.model.js';

export type AuthenticatedRequest = Request & { account?: CurrentAccountModel };

/** Lấy tài khoản đang đăng nhập do AuthGuard gắn vào request. */
export const CurrentAccount = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>().account;
});
