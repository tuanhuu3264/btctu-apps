import { Injectable } from '@nestjs/common';
import { requestContext } from '../../../common/request-context.js';
import { AuditService } from './audit.service.js';
import { MfaService } from './mfa.service.js';
import type { LoginStep } from './mfa.service.js';
import { Authenticator } from './ports.js';
import { SessionService } from './session.service.js';
import type { IssuedSession } from './session.service.js';
import type { Credentials, CurrentAccount } from './security.model.js';

/** Đăng nhập xong: có phiên. */
export interface LoginResult {
  mfa?: undefined;
  account: CurrentAccount;
  session: IssuedSession;
}

/** Mật khẩu đúng nhưng còn bước MFA: chưa có phiên, chỉ có thẻ thử thách ngắn hạn. */
export interface MfaPending {
  mfa: LoginStep;
  challenge: string;
  expiresInSeconds: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly authenticator: Authenticator,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
  ) {}

  async login(credentials: Credentials): Promise<LoginResult | MfaPending> {
    const account = await this.authenticator.authenticate(credentials);
    const step = await this.mfa.stepAfterPassword(account.id);
    if (step) return { mfa: step, ...this.mfa.issueChallenge(account.id, step) };
    return this.openSession(account);
  }

  /** Cấp phiên sau khi đủ yếu tố (mật khẩu, và mã nếu có). */
  async openSession(account: CurrentAccount): Promise<LoginResult> {
    const session = await this.sessions.issue(account.id);
    await this.audit.record({
      action: 'auth.login.success',
      outcome: 'SUCCESS',
      actor: { id: account.id, username: account.username },
      targetType: 'account',
      targetId: account.id,
    });
    return { account, session };
  }

  async logout(token: string | undefined): Promise<void> {
    await this.sessions.revoke(token);
    const actor = requestContext.get()?.actor;
    if (actor) {
      await this.audit.record({ action: 'auth.logout', outcome: 'SUCCESS', targetType: 'account', targetId: actor.id });
    }
  }
}
