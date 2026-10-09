import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AccountRepository, SessionRepository } from './ports.js';
import { SecurityConfig } from './security.config.js';
import type { CurrentAccount } from './security.model.js';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly accounts: AccountRepository,
    private readonly clock: Clock,
    private readonly config: SecurityConfig,
  ) {}

  async issue(accountId: string): Promise<IssuedSession> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.clock.now().getTime() + this.config.sessionTtlHours * 3_600_000);
    await this.sessions.create({ accountId, tokenHash: hashToken(token), expiresAt });
    return { token, expiresAt };
  }

  /** Trả về tài khoản nếu phiên còn hiệu lực, ngược lại null. */
  async resolve(token: string | undefined): Promise<CurrentAccount | null> {
    if (!token) return null;
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (!session || session.revokedAt || session.expiresAt <= this.clock.now()) return null;

    const account = await this.accounts.findById(session.accountId);
    if (!account || account.status !== 'ACTIVE') return null;
    return { id: account.id, username: account.username, personId: account.personId };
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.revoke(hashToken(token), this.clock.now());
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
