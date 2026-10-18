import { Body, Controller, Get, HttpCode, NotFoundException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthorizationService } from '../application/authorization.service.js';
import type { EffectiveAccess } from '../application/authorization.service.js';
import { AuthService } from '../application/auth.service.js';
import type { LoginResult, MfaPending } from '../application/auth.service.js';
import { MfaService } from '../application/mfa.service.js';
import type { MfaEnrollment, MfaStatus } from '../application/mfa.service.js';
import { AccountRepository } from '../application/ports.js';
import { SecurityConfig } from '../application/security.config.js';
import { SessionService } from '../application/session.service.js';
import type { SessionStatus } from '../application/session.service.js';
import type { CurrentAccount as CurrentAccountModel } from '../application/security.model.js';
import { CurrentAccount } from './current-account.decorator.js';
import { LoginDto } from './login.dto.js';
import { MfaChallengeCodeDto, MfaChallengeDto, MfaCodeDto, MfaDisableDto } from './mfa.dto.js';
import { Public } from './public.decorator.js';
import { Authenticated } from './require-permission.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly authorization: AuthorizationService,
    private readonly config: SecurityConfig,
    private readonly mfa: MfaService,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response): Promise<CurrentAccountModel | MfaPending> {
    return this.respond(await this.auth.login(dto), res);
  }

  /** Bước 2 khi tài khoản đã đăng ký MFA: nhập mã TOTP hoặc mã khôi phục. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  async mfaVerify(@Body() dto: MfaChallengeCodeDto, @Res({ passthrough: true }) res: Response): Promise<CurrentAccountModel> {
    const account = await this.mfa.accountFromChallenge(dto.challenge, 'VERIFY');
    await this.mfa.verifyLogin(account, dto.code);
    return this.respondSession(await this.auth.openSession(toCurrent(account)), res);
  }

  /** Bước 2 khi vai trò bắt buộc MFA mà chưa đăng ký: lấy khóa và mã QR. */
  @Public()
  @Post('mfa/enroll/start')
  @HttpCode(200)
  async mfaEnrollStart(@Body() dto: MfaChallengeDto): Promise<MfaEnrollment> {
    return this.mfa.beginEnrollment(await this.mfa.accountFromChallenge(dto.challenge, 'ENROLL'));
  }

  /** Xác nhận bằng mã đầu tiên: bật MFA, trả mã khôi phục (một lần) và mở phiên. */
  @Public()
  @Post('mfa/enroll/confirm')
  @HttpCode(200)
  async mfaEnrollConfirm(
    @Body() dto: MfaChallengeCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ account: CurrentAccountModel; recoveryCodes: string[] }> {
    const account = await this.mfa.accountFromChallenge(dto.challenge, 'ENROLL');
    const recoveryCodes = await this.mfa.confirmEnrollment(account, dto.code);
    return { account: this.respondSession(await this.auth.openSession(toCurrent(account)), res), recoveryCodes };
  }

  @Authenticated()
  @Get('mfa')
  mfaStatus(@CurrentAccount() account: CurrentAccountModel): Promise<MfaStatus> {
    return this.mfa.status(account.id);
  }

  /** Người đã đăng nhập tự đăng ký MFA (khi chế độ không bắt buộc). */
  @Authenticated()
  @Post('mfa/setup/start')
  @HttpCode(200)
  mfaSetupStart(@CurrentAccount() account: CurrentAccountModel): Promise<MfaEnrollment> {
    return this.mfa.beginEnrollment(account);
  }

  @Authenticated()
  @Post('mfa/setup/confirm')
  @HttpCode(200)
  async mfaSetupConfirm(@CurrentAccount() current: CurrentAccountModel, @Body() dto: MfaCodeDto): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.mfa.confirmEnrollment(await this.fullAccount(current.id), dto.code) };
  }

  @Authenticated()
  @Post('mfa/recovery-codes')
  @HttpCode(200)
  async mfaRecovery(@CurrentAccount() current: CurrentAccountModel, @Body() dto: MfaCodeDto): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(await this.fullAccount(current.id), dto.code) };
  }

  @Authenticated()
  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(@CurrentAccount() current: CurrentAccountModel, @Body() dto: MfaDisableDto): Promise<void> {
    await this.mfa.disableSelf(await this.fullAccount(current.id), dto.password, dto.code);
  }

  private async fullAccount(id: string) {
    const account = await this.accounts.findById(id);
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản');
    return account;
  }

  /** Có phiên thì đặt cookie và trả tài khoản; còn bước MFA thì trả nguyên yêu cầu. */
  private respond(result: LoginResult | MfaPending, res: Response): CurrentAccountModel | MfaPending {
    return result.mfa ? result : this.respondSession(result, res);
  }

  private respondSession(result: LoginResult, res: Response): CurrentAccountModel {
    res.cookie(this.config.cookieName, result.session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.cookieSecure,
      expires: result.session.expiresAt,
      path: '/',
    });
    return result.account;
  }

  @Authenticated()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[this.config.cookieName] as string | undefined);
    res.clearCookie(this.config.cookieName, { path: '/' });
  }

  /** Thời gian còn lại của phiên. Không tính là thao tác (giao diện hỏi định kỳ để cảnh báo trước khi phiên đóng). */
  @Authenticated()
  @Get('session')
  async sessionStatus(@Req() req: Request): Promise<SessionStatus> {
    return this.orExpired(await this.sessions.status(req.cookies?.[this.config.cookieName] as string | undefined));
  }

  /** Giao diện báo người dùng đang thao tác (chuột, bàn phím) để gia hạn thời gian không thao tác (ADR-057). */
  @Authenticated()
  @Post('session/keepalive')
  @HttpCode(200)
  async keepAlive(@Req() req: Request): Promise<SessionStatus> {
    return this.orExpired(await this.sessions.keepAlive(req.cookies?.[this.config.cookieName] as string | undefined));
  }

  private orExpired(status: SessionStatus | null): SessionStatus {
    if (!status) throw new UnauthorizedException('Chưa đăng nhập hoặc phiên đã hết hạn');
    return status;
  }

  @Authenticated()
  @Get('me')
  async me(@CurrentAccount() account: CurrentAccountModel): Promise<CurrentAccountModel & EffectiveAccess> {
    return { ...account, ...(await this.authorization.accessOf(account.id)) };
  }
}

const toCurrent = (a: { id: string; username: string; personId: string | null }): CurrentAccountModel => ({ id: a.id, username: a.username, personId: a.personId });
