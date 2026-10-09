import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from './audit.service.js';
import { AccountRepository, Authenticator, PasswordHasher } from './ports.js';
import { SecurityConfig } from './security.config.js';
import type { Credentials, CurrentAccount } from './security.model.js';

/** Một thông báo cho mọi lý do thất bại để không lộ tài khoản có tồn tại hay đang bị khóa. */
export const INVALID_LOGIN_MESSAGE = 'Tên đăng nhập hoặc mật khẩu không đúng, hoặc tài khoản tạm thời bị khóa';

type FailureReason = 'unknown-or-disabled' | 'locked' | 'bad-password';

@Injectable()
export class PasswordAuthenticator extends Authenticator {
  /** Băm giả để thời gian xử lý khi không có tài khoản gần bằng khi có tài khoản. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly accounts: AccountRepository,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly config: SecurityConfig,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async authenticate(credentials: Credentials): Promise<CurrentAccount> {
    const username = credentials.username.trim().toLowerCase();
    const account = await this.accounts.findByUsername(username);

    if (!account || account.status !== 'ACTIVE') {
      await this.hasher.verify(await this.getDummyHash(), credentials.password);
      throw await this.fail(username, 'unknown-or-disabled', account?.id);
    }

    const now = this.clock.now();
    if (account.lockedUntil && account.lockedUntil > now) {
      throw await this.fail(username, 'locked', account.id);
    }

    if (!(await this.hasher.verify(account.passwordHash, credentials.password))) {
      await this.recordFailure(account.id, username, account.failedAttempts, now);
      throw await this.fail(username, 'bad-password', account.id);
    }

    if (account.failedAttempts !== 0 || account.lockedUntil) {
      await this.accounts.updateLoginState(account.id, { failedAttempts: 0, lockedUntil: null });
    }
    return { id: account.id, username: account.username, personId: account.personId };
  }

  /** Ghi nhật ký rồi trả lỗi chung; lý do thật chỉ nằm trong nhật ký, không gửi cho người dùng. */
  private async fail(attemptedUsername: string, reason: FailureReason, accountId?: string): Promise<UnauthorizedException> {
    await this.audit.record({
      action: 'auth.login.failure',
      outcome: 'FAILURE',
      actor: null,
      targetType: accountId ? 'account' : undefined,
      targetId: accountId,
      details: { attemptedUsername, reason },
    });
    return new UnauthorizedException(INVALID_LOGIN_MESSAGE);
  }

  private async recordFailure(id: string, username: string, previousFailures: number, now: Date): Promise<void> {
    const failures = previousFailures + 1;
    if (failures >= this.config.maxFailedAttempts) {
      const lockedUntil = new Date(now.getTime() + this.config.lockMinutes * 60_000);
      await this.accounts.updateLoginState(id, { failedAttempts: 0, lockedUntil });
      await this.audit.record({
        action: 'auth.account.locked',
        outcome: 'SUCCESS',
        actor: null,
        targetType: 'account',
        targetId: id,
        details: { username, lockedUntil, afterFailures: failures },
      });
    } else {
      await this.accounts.updateLoginState(id, { failedAttempts: failures, lockedUntil: null });
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('mat-khau-gia-de-can-bang-thoi-gian');
    return this.dummyHash;
  }
}
