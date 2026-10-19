import { Clock } from '../../../../common/clock.js';
import type { AccountSummary, NewRoleAssignment, RoleAssignmentModel } from '../authorization.model.js';
import type { AuditQuery, AuditRecord, AuditRecordDraft } from '../audit.model.js';
import { GENESIS_HASH } from '../audit.model.js';
import {
  AccountRepository,
  AuditLogRepository,
  MfaRepository,
  PasswordHasher,
  RoleAssignmentRepository,
  SessionRepository,
} from '../ports.js';
import type {
  AccountModel,
  AccountStatus,
  LoginState,
  MfaModel,
  NewAccount,
  NewSession,
  SessionModel,
} from '../security.model.js';

/** Đối tượng giả dùng chung cho test lớp nghiệp vụ của mô-đun security. */

export class FakeHasher extends PasswordHasher {
  async hash(plain: string) {
    return `h:${plain}`;
  }
  async verify(hash: string, plain: string) {
    return hash === `h:${plain}`;
  }
}

export class FakeClock extends Clock {
  current = new Date('2026-10-03T08:00:00Z');
  now() {
    return new Date(this.current);
  }
  advanceMinutes(m: number) {
    this.current = new Date(this.current.getTime() + m * 60_000);
  }
}

export class InMemoryAccounts extends AccountRepository {
  rows: AccountModel[] = [];
  async findById(id: string) {
    return this.rows.find((a) => a.id === id) ?? null;
  }
  async findByUsername(username: string) {
    return this.rows.find((a) => a.username === username) ?? null;
  }
  async findByPersonId(personId: string) {
    return this.rows.find((a) => a.personId === personId) ?? null;
  }
  async findAll(): Promise<AccountSummary[]> {
    return this.rows.map(({ id, username, status, personId, lockedUntil }) => ({
      id,
      username,
      status,
      personId,
      lockedUntil,
    }));
  }
  async create(data: NewAccount) {
    const row: AccountModel = {
      ...data,
      id: `a${this.rows.length + 1}`,
      status: 'ACTIVE',
      failedAttempts: 0,
      lockedUntil: null,
    };
    this.rows.push(row);
    return row;
  }
  async updateLoginState(id: string, state: LoginState) {
    Object.assign(this.rows.find((a) => a.id === id)!, state);
  }
  async setStatus(id: string, status: AccountStatus) {
    this.rows.find((a) => a.id === id)!.status = status;
  }
  async setPersonId(id: string, personId: string | null) {
    this.rows.find((a) => a.id === id)!.personId = personId;
  }
}

export class InMemorySessions extends SessionRepository {
  rows: SessionModel[] = [];
  async create(data: NewSession) {
    const row: SessionModel = { ...data, lastActiveAt: data.lastActiveAt ?? new Date(), id: `s${this.rows.length + 1}`, revokedAt: null };
    this.rows.push(row);
    return row;
  }
  async findByTokenHash(tokenHash: string) {
    return this.rows.find((s) => s.tokenHash === tokenHash) ?? null;
  }
  async revoke(tokenHash: string, at: Date) {
    const s = this.rows.find((r) => r.tokenHash === tokenHash);
    if (s && !s.revokedAt) s.revokedAt = at;
  }
  async touch(tokenHash: string, at: Date) {
    const s = this.rows.find((r) => r.tokenHash === tokenHash);
    if (s && !s.revokedAt) s.lastActiveAt = at;
  }
  async revokeAllForAccount(accountId: string, at: Date) {
    for (const s of this.rows) if (s.accountId === accountId && !s.revokedAt) s.revokedAt = at;
  }
}

export class InMemoryRoleAssignments extends RoleAssignmentRepository {
  rows: RoleAssignmentModel[] = [];
  async create(data: NewRoleAssignment) {
    const row: RoleAssignmentModel = { ...data, id: `r${this.rows.length + 1}`, revokedAt: null };
    this.rows.push(row);
    return row;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByAccount(accountId: string) {
    return this.rows.filter((r) => r.accountId === accountId);
  }
  async revoke(id: string, at: Date) {
    this.rows.find((r) => r.id === id)!.revokedAt = at;
  }
  async findLive(at: Date) {
    return this.rows.filter((r) => !r.revokedAt && (r.validTo === null || r.validTo > at));
  }
}

export class InMemoryAuditLog extends AuditLogRepository {
  rows: AuditRecord[] = [];
  async append(build: (prevHash: string) => AuditRecordDraft) {
    const prev = this.rows[this.rows.length - 1]?.hash ?? GENESIS_HASH;
    const row: AuditRecord = { ...build(prev), id: String(this.rows.length + 1) };
    this.rows.push(row);
    return row;
  }
  async find(query: AuditQuery) {
    return this.rows
      .filter((r) => (!query.action || r.action === query.action) && (!query.actorId || r.actorAccountId === query.actorId))
      .filter((r) => (!query.username || r.actorUsername === query.username) && (!query.outcome || r.outcome === query.outcome))
      .filter((r) => (!query.module || r.module === query.module) && (!query.type || r.type === query.type))
      .filter((r) => (!query.targetType || r.targetType === query.targetType) && (!query.targetId || r.targetId === query.targetId))
      .filter((r) => (!query.from || r.occurredAt >= query.from) && (!query.to || r.occurredAt < query.to))
      .filter((r) => !query.beforeId || Number(r.id) < Number(query.beforeId))
      .reverse()
      .slice(0, query.limit ?? 50);
  }
  async distinctActions() {
    return [...new Set(this.rows.map((r) => r.action))].sort();
  }
  async findAfter(afterId: string | null, limit: number) {
    return this.rows.filter((r) => Number(r.id) > Number(afterId ?? 0)).slice(0, limit);
  }
  actions() {
    return this.rows.map((r) => r.action);
  }
}

export class InMemoryMfa extends MfaRepository {
  rows: MfaModel[] = [];
  async find(accountId: string) {
    return this.rows.find((r) => r.accountId === accountId) ?? null;
  }
  async savePending(accountId: string, secretEnc: string) {
    this.rows = this.rows.filter((r) => r.accountId !== accountId);
    this.rows.push({ accountId, secretEnc, enabled: false, recoveryHashes: [], lastStep: null, enabledAt: null });
  }
  async enable(accountId: string, data: { recoveryHashes: string[]; lastStep: number; at: Date }) {
    Object.assign(this.rows.find((r) => r.accountId === accountId)!, { enabled: true, recoveryHashes: data.recoveryHashes, lastStep: data.lastStep, enabledAt: data.at });
  }
  async setLastStep(accountId: string, step: number) {
    this.rows.find((r) => r.accountId === accountId)!.lastStep = step;
  }
  async setRecoveryHashes(accountId: string, hashes: string[]) {
    this.rows.find((r) => r.accountId === accountId)!.recoveryHashes = hashes;
  }
  async remove(accountId: string) {
    this.rows = this.rows.filter((r) => r.accountId !== accountId);
  }
}
