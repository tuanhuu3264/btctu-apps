import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthorizationService } from '../application/authorization.service.js';
import type { EffectiveAccess } from '../application/authorization.service.js';
import { AuthService } from '../application/auth.service.js';
import { SecurityConfig } from '../application/security.config.js';
import type { CurrentAccount as CurrentAccountModel } from '../application/security.model.js';
import { CurrentAccount } from './current-account.decorator.js';
import { LoginDto } from './login.dto.js';
import { Public } from './public.decorator.js';
import { Authenticated } from './require-permission.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authorization: AuthorizationService,
    private readonly config: SecurityConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<CurrentAccountModel> {
    const { account, session } = await this.auth.login(dto);
    res.cookie(this.config.cookieName, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      expires: session.expiresAt,
      path: '/',
    });
    return account;
  }

  @Authenticated()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[this.config.cookieName] as string | undefined);
    res.clearCookie(this.config.cookieName, { path: '/' });
  }

  @Authenticated()
  @Get('me')
  async me(@CurrentAccount() account: CurrentAccountModel): Promise<CurrentAccountModel & EffectiveAccess> {
    return { ...account, ...(await this.authorization.accessOf(account.id)) };
  }
}
