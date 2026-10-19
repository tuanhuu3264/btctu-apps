import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { InactiveInfo, NewUnit, UnitModel, UnitPatch } from '../application/unit.model.js';
import { UnitRepository } from '../application/unit.repository.js';
import { UnitEntity } from './unit.entity.js';

@Injectable()
export class TypeOrmUnitRepository extends UnitRepository {
  constructor(@InjectRepository(UnitEntity) private readonly repo: Repository<UnitEntity>) {
    super();
  }

  async findAll(): Promise<UnitModel[]> {
    return (await this.repo.find({ order: { code: 'ASC' } })).map(toModel);
  }

  async findById(id: string): Promise<UnitModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toModel(row) : null;
  }

  async findByCode(code: string): Promise<UnitModel | null> {
    const row = await this.repo.findOneBy({ code });
    return row ? toModel(row) : null;
  }

  async create(data: NewUnit): Promise<UnitModel> {
    return toModel(await this.repo.save(this.repo.create({ ...data, status: 'ACTIVE', inactiveAt: null, inactiveReason: null })));
  }

  async update(id: string, patch: UnitPatch): Promise<UnitModel> {
    await this.repo.update({ id }, patch);
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async setStatus(id: string, info: InactiveInfo): Promise<UnitModel> {
    await this.repo.update({ id }, info);
    return toModel(await this.repo.findOneByOrFail({ id }));
  }
}

function toModel(e: UnitEntity): UnitModel {
  return {
    id: e.id,
    code: e.code,
    name: e.name,
    type: e.type,
    parentId: e.parentId,
    status: e.status,
    inactiveAt: e.inactiveAt,
    inactiveReason: e.inactiveReason,
  };
}
