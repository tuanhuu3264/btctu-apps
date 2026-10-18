import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MfaRepository } from '../application/ports.js';
import type { MfaModel } from '../application/security.model.js';
import { AccountMfaEntity } from './account-mfa.entity.js';

@Injectable()
export class TypeOrmMfaRepository extends MfaRepository {
  constructor(@InjectRepository(AccountMfaEntity) private readonly repo: Repository<AccountMfaEntity>) {
    super();
  }

  async find(accountId: string): Promise<MfaModel | null> {
    const row = await this.repo.findOneBy({ accountId });
    return row
      ? {
          accountId: row.accountId,
          secretEnc: row.secretEnc,
          enabled: row.enabled,
          recoveryHashes: row.recoveryHashes,
          lastStep: row.lastStep === null ? null : Number(row.lastStep),
          enabledAt: row.enabledAt,
        }
      : null;
  }

  async savePending(accountId: string, secretEnc: string): Promise<void> {
    await this.repo.upsert({ accountId, secretEnc, enabled: false, recoveryHashes: [], lastStep: null, enabledAt: null }, ['accountId']);
  }

  async enable(accountId: string, data: { recoveryHashes: string[]; lastStep: number; at: Date }): Promise<void> {
    await this.repo.update({ accountId }, { enabled: true, recoveryHashes: data.recoveryHashes, lastStep: String(data.lastStep), enabledAt: data.at });
  }

  async setLastStep(accountId: string, step: number): Promise<void> {
    await this.repo.update({ accountId }, { lastStep: String(step) });
  }

  async setRecoveryHashes(accountId: string, hashes: string[]): Promise<void> {
    await this.repo.update({ accountId }, { recoveryHashes: hashes });
  }

  async remove(accountId: string): Promise<void> {
    await this.repo.delete({ accountId });
  }
}
