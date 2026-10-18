import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AccountRepository, SessionRepository } from './ports.js';
import { SecurityConfig } from './security.config.js';
import type { CurrentAccount, SessionModel } from './security.model.js';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** Thời gian còn lại của phiên, để giao diện cảnh báo trước khi phiên đóng (ADR-057). */
export interface SessionStatus {
  /** Số giây còn lại nếu không thao tác thêm. */
  idleSecondsLeft: number;
  /** Số giây còn lại đến hạn tuyệt đối của phiên (thao tác cũng không gia hạn được). */
  absoluteSecondsLeft: number;
  /** Số phút không thao tác thì đóng phiên. */
  idleMinutes: number;
}

/** Ghi lần thao tác vào phiên tối đa mỗi chừng này giây, để không ghi cơ sở dữ liệu ở mọi lần giữ phiên. */
const TOUCH_INTERVAL_SECONDS = 30;

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
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.sessionTtlHours * 3_600_000);
    await this.sessions.create({ accountId, tokenHash: hashToken(token), expiresAt, lastActiveAt: now });
    return { token, expiresAt };
  }

  /**
   * Trả về tài khoản nếu phiên còn hiệu lực, ngược lại null. Phiên không còn hiệu lực khi đã thu hồi, quá hạn tuyệt đối, hoặc
   * quá số phút không thao tác. Việc gọi API thông thường (kể cả làm mới định kỳ của giao diện) không tính là thao tác.
   */
  async resolve(token: string | undefined): Promise<CurrentAccount | null> {
    const session = await this.liveSession(token);
    if (!session) return null;
    const account = await this.accounts.findById(session.accountId);
    if (!account || account.status !== 'ACTIVE') return null;
    return { id: account.id, username: account.username, personId: account.personId };
  }

  /** Ghi nhận người dùng đang thao tác ("giữ phiên"); trả thời gian còn lại, hoặc null nếu phiên đã không dùng được. */
  async keepAlive(token: string | undefined): Promise<SessionStatus | null> {
    const session = await this.liveSession(token);
    if (!session || !token) return null;
    const now = this.clock.now();
    if ((now.getTime() - session.lastActiveAt.getTime()) / 1000 >= TOUCH_INTERVAL_SECONDS) {
      await this.sessions.touch(hashToken(token), now);
      return this.statusAt({ ...session, lastActiveAt: now }, now);
    }
    return this.statusAt(session, now);
  }

  /** Thời gian còn lại của phiên mà không tính là thao tác. */
  async status(token: string | undefined): Promise<SessionStatus | null> {
    const session = await this.liveSession(token);
    return session ? this.statusAt(session, this.clock.now()) : null;
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.sessions.revoke(hashToken(token), this.clock.now());
  }

  private async liveSession(token: string | undefined): Promise<SessionModel | null> {
    if (!token) return null;
    const session = await this.sessions.findByTokenHash(hashToken(token));
    if (!session || session.revokedAt) return null;
    const now = this.clock.now();
    if (session.expiresAt <= now) return null;
    if (this.idleDeadline(session) <= now.getTime()) return null;
    return session;
  }

  private idleDeadline(session: SessionModel): number {
    return session.lastActiveAt.getTime() + this.config.sessionIdleMinutes * 60_000;
  }

  private statusAt(session: SessionModel, now: Date): SessionStatus {
    const absoluteSecondsLeft = Math.max(Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000), 0);
    const idleSecondsLeft = Math.max(Math.floor((this.idleDeadline(session) - now.getTime()) / 1000), 0);
    return { idleSecondsLeft: Math.min(idleSecondsLeft, absoluteSecondsLeft), absoluteSecondsLeft, idleMinutes: this.config.sessionIdleMinutes };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
