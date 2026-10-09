import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from './audit.service.js';
import type { AccountSummary } from './authorization.model.js';
import { AccountRepository, PasswordHasher, SessionRepository } from './ports.js';
import { SecurityConfig } from './security.config.js';
import type { CurrentAccount } from './security.model.js';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

export interface CreateAccountInput {
  username: string;
  password: string;
  personId?: string | null;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly config: SecurityConfig,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AccountSummary[]> {
    const rows = await this.accounts.findAll();
    await this.audit.record({ action: 'account.list', outcome: 'SUCCESS', details: { count: rows.length } });
    return rows;
  }

  async create(input: CreateAccountInput): Promise<CurrentAccount> {
    const username = input.username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      throw new BadRequestException('Tên đăng nhập gồm 3–64 ký tự: chữ thường, số, dấu chấm, gạch dưới, gạch nối');
    }
    this.assertPasswordPolicy(username, input.password);

    if (await this.accounts.findByUsername(username)) {
      throw new ConflictException(`Tên đăng nhập đã tồn tại: ${username}`);
    }
    const account = await this.accounts.create({
      username,
      passwordHash: await this.hasher.hash(input.password),
      personId: input.personId ?? null,
    });
    await this.audit.record({
      action: 'account.create',
      outcome: 'SUCCESS',
      targetType: 'account',
      targetId: account.id,
      details: { username: account.username, personId: account.personId },
    });
    return { id: account.id, username: account.username, personId: account.personId };
  }

  /** Vô hiệu hóa tài khoản và thu hồi mọi phiên đang mở. Không tự vô hiệu hóa chính mình. */
  async disable(actor: CurrentAccount, accountId: string): Promise<void> {
    if (actor.id === accountId) {
      throw new ForbiddenException('Không được tự vô hiệu hóa tài khoản của chính mình');
    }
    const target = await this.accounts.findById(accountId);
    if (!target) {
      throw new NotFoundException(`Không tìm thấy tài khoản: ${accountId}`);
    }
    await this.accounts.setStatus(accountId, 'DISABLED');
    await this.sessions.revokeAllForAccount(accountId, this.clock.now());
    await this.audit.record({
      action: 'account.disable',
      outcome: 'SUCCESS',
      targetType: 'account',
      targetId: accountId,
      details: { username: target.username, previousStatus: target.status },
    });
  }

  /**
   * Gắn tài khoản với cán bộ (đã được nơi gọi kiểm tra là tồn tại). Mỗi tài khoản gắn một cán bộ,
   * mỗi cán bộ có một tài khoản. Gỡ liên kết trước khi gắn lại với người khác.
   */
  async linkPerson(accountId: string, personId: string): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new NotFoundException(`Không tìm thấy tài khoản: ${accountId}`);
    if (account.personId === personId) return;
    if (account.personId) throw new ConflictException('Tài khoản đã gắn với một cán bộ khác, hãy gỡ liên kết trước');
    if (await this.accounts.findByPersonId(personId)) {
      throw new ConflictException('Cán bộ này đã có tài khoản');
    }
    await this.accounts.setPersonId(accountId, personId);
    await this.audit.record({
      action: 'account.link-person',
      outcome: 'SUCCESS',
      targetType: 'account',
      targetId: accountId,
      details: { username: account.username, personId },
    });
  }

  async unlinkPerson(accountId: string): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account) throw new NotFoundException(`Không tìm thấy tài khoản: ${accountId}`);
    if (!account.personId) return;
    await this.accounts.setPersonId(accountId, null);
    await this.audit.record({
      action: 'account.unlink-person',
      outcome: 'SUCCESS',
      targetType: 'account',
      targetId: accountId,
      details: { username: account.username, previousPersonId: account.personId },
    });
  }

  async findByPersonId(personId: string): Promise<CurrentAccount | null> {
    const account = await this.accounts.findByPersonId(personId);
    return account ? { id: account.id, username: account.username, personId: account.personId } : null;
  }

  private assertPasswordPolicy(username: string, password: string): void {
    if (password.length < this.config.minPasswordLength) {
      throw new BadRequestException(`Mật khẩu phải có ít nhất ${this.config.minPasswordLength} ký tự`);
    }
    if (password.toLowerCase().includes(username)) {
      throw new BadRequestException('Mật khẩu không được chứa tên đăng nhập');
    }
  }
}
