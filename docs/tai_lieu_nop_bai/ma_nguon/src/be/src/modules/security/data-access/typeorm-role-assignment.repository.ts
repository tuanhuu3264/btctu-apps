import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { NewRoleAssignment, RoleAssignmentModel } from '../application/authorization.model.js';
import { RoleAssignmentRepository } from '../application/ports.js';
import { AccountRoleEntity } from './account-role.entity.js';

@Injectable()
export class TypeOrmRoleAssignmentRepository extends RoleAssignmentRepository {
  constructor(@InjectRepository(AccountRoleEntity) private readonly repo: Repository<AccountRoleEntity>) {
    super();
  }

  async create(data: NewRoleAssignment): Promise<RoleAssignmentModel> {
    return toModel(await this.repo.save(this.repo.create(data)));
  }

  async findById(id: string): Promise<RoleAssignmentModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toModel(row) : null;
  }

  async findByAccount(accountId: string): Promise<RoleAssignmentModel[]> {
    return (await this.repo.find({ where: { accountId }, order: { createdAt: 'ASC' } })).map(toModel);
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.repo.update({ id }, { revokedAt: at });
  }

  async findLive(at: Date): Promise<RoleAssignmentModel[]> {
    const rows = await this.repo.find({ where: { revokedAt: IsNull() }, order: { createdAt: 'ASC' } });
    return rows.filter((r) => r.validTo === null || r.validTo > at).map(toModel);
  }
}

function toModel(e: AccountRoleEntity): RoleAssignmentModel {
  return {
    id: e.id,
    accountId: e.accountId,
    role: e.role,
    validFrom: e.validFrom,
    validTo: e.validTo,
    grantedBy: e.grantedBy,
    revokedAt: e.revokedAt,
  };
}
