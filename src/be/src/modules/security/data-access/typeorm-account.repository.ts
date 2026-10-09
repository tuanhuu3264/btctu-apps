import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountRepository } from '../application/ports.js';
import type { AccountSummary } from '../application/authorization.model.js';
import type { AccountModel, AccountStatus, LoginState, NewAccount } from '../application/security.model.js';
import { AccountEntity } from './account.entity.js';

@Injectable()
export class TypeOrmAccountRepository extends AccountRepository {
  constructor(@InjectRepository(AccountEntity) private readonly repo: Repository<AccountEntity>) {
    super();
  }

  async findById(id: string): Promise<AccountModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toModel(row) : null;
  }

  async findByUsername(username: string): Promise<AccountModel | null> {
    const row = await this.repo.findOneBy({ username });
    return row ? toModel(row) : null;
  }

  async findByPersonId(personId: string): Promise<AccountModel | null> {
    const row = await this.repo.findOneBy({ personId });
    return row ? toModel(row) : null;
  }

  async findAll(): Promise<AccountSummary[]> {
    const rows = await this.repo.find({ order: { username: 'ASC' } });
    return rows.map((e) => ({
      id: e.id,
      username: e.username,
      status: e.status,
      personId: e.personId,
      lockedUntil: e.lockedUntil,
    }));
  }

  async create(data: NewAccount): Promise<AccountModel> {
    return toModel(await this.repo.save(this.repo.create(data)));
  }

  async updateLoginState(id: string, state: LoginState): Promise<void> {
    await this.repo.update({ id }, { failedAttempts: state.failedAttempts, lockedUntil: state.lockedUntil });
  }

  async setStatus(id: string, status: AccountStatus): Promise<void> {
    await this.repo.update({ id }, { status });
  }

  async setPersonId(id: string, personId: string | null): Promise<void> {
    await this.repo.update({ id }, { personId });
  }
}

function toModel(e: AccountEntity): AccountModel {
  return {
    id: e.id,
    username: e.username,
    passwordHash: e.passwordHash,
    status: e.status,
    failedAttempts: e.failedAttempts,
    lockedUntil: e.lockedUntil,
    personId: e.personId,
  };
}
