import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NewUnit, UnitModel, UnitPatch } from '../application/unit.model.js';
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
    return toModel(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: UnitPatch): Promise<UnitModel> {
    await this.repo.update({ id }, patch);
    return toModel(await this.repo.findOneByOrFail({ id }));
  }

  async delete(id: string): Promise<'OK' | 'IN_USE'> {
    try {
      await this.repo.delete({ id });
      return 'OK';
    } catch (e) {
      if ((e as { driverError?: { code?: string } }).driverError?.code === '23503') return 'IN_USE'; // vi phạm khóa ngoại
      throw e;
    }
  }
}

function toModel(e: UnitEntity): UnitModel {
  return { id: e.id, code: e.code, name: e.name, type: e.type, parentId: e.parentId };
}
