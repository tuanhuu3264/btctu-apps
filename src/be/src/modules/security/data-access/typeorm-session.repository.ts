import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionRepository } from '../application/ports.js';
import type { NewSession, SessionModel } from '../application/security.model.js';
import { SessionEntity } from './session.entity.js';

@Injectable()
export class TypeOrmSessionRepository extends SessionRepository {
  constructor(@InjectRepository(SessionEntity) private readonly repo: Repository<SessionEntity>) {
    super();
  }

  async create(data: NewSession): Promise<SessionModel> {
    return toModel(await this.repo.save(this.repo.create(data)));
  }

  async findByTokenHash(tokenHash: string): Promise<SessionModel | null> {
    const row = await this.repo.findOneBy({ tokenHash });
    return row ? toModel(row) : null;
  }

  async revoke(tokenHash: string, at: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: at })
      .where('token_hash = :tokenHash AND revoked_at IS NULL', { tokenHash })
      .execute();
  }

  async touch(tokenHash: string, at: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ lastActiveAt: at })
      .where('token_hash = :tokenHash AND revoked_at IS NULL', { tokenHash })
      .execute();
  }

  async revokeAllForAccount(accountId: string, at: Date): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update()
      .set({ revokedAt: at })
      .where('account_id = :accountId AND revoked_at IS NULL', { accountId })
      .execute();
  }
}

function toModel(e: SessionEntity): SessionModel {
  return { id: e.id, accountId: e.accountId, tokenHash: e.tokenHash, expiresAt: e.expiresAt, lastActiveAt: e.lastActiveAt, revokedAt: e.revokedAt };
}
