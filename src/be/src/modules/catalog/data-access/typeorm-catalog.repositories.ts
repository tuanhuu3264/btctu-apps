import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type {
  CatalogGroupModel,
  CatalogItemModel,
  CatalogItemPatch,
  CatalogScope,
  CatalogScopeRow,
  CatalogTaskModel,
  CatalogTaskPatch,
  CatalogVersionModel,
  NewCatalogItem,
  NewCatalogTask,
  NewCatalogVersion,
} from '../application/catalog.model.js';
import { CatalogGroupRepository, CatalogItemRepository, CatalogScopeRepository, CatalogTaskRepository, CatalogVersionRepository } from '../application/catalog.ports.js';
import { CatalogGroupEntity, CatalogItemEntity, CatalogItemScopeEntity, CatalogTaskEntity, CatalogVersionEntity } from './catalog.entities.js';

@Injectable()
export class TypeOrmCatalogGroupRepository extends CatalogGroupRepository {
  constructor(@InjectRepository(CatalogGroupEntity) private readonly repo: Repository<CatalogGroupEntity>) {
    super();
  }

  async findAll(): Promise<CatalogGroupModel[]> {
    return (await this.repo.find({ order: { sortOrder: 'ASC' } })).map((e) => ({
      code: e.code,
      name: e.name,
      sortOrder: e.sortOrder,
    }));
  }

  async findByCode(code: string): Promise<CatalogGroupModel | null> {
    const row = await this.repo.findOneBy({ code });
    return row ? { code: row.code, name: row.name, sortOrder: row.sortOrder } : null;
  }

  async upsert(group: CatalogGroupModel): Promise<void> {
    await this.repo.save(this.repo.create(group));
  }

  async rename(code: string, name: string): Promise<CatalogGroupModel> {
    await this.repo.update({ code }, { name });
    const row = await this.repo.findOneByOrFail({ code });
    return { code: row.code, name: row.name, sortOrder: row.sortOrder };
  }

  async delete(code: string): Promise<void> {
    await this.repo.delete({ code });
  }
}

@Injectable()
export class TypeOrmCatalogVersionRepository extends CatalogVersionRepository {
  constructor(@InjectRepository(CatalogVersionEntity) private readonly repo: Repository<CatalogVersionEntity>) {
    super();
  }

  async findById(id: string): Promise<CatalogVersionModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toVersion(row) : null;
  }

  async findByLabel(label: string): Promise<CatalogVersionModel | null> {
    const row = await this.repo.findOneBy({ label });
    return row ? toVersion(row) : null;
  }

  async findAll(): Promise<CatalogVersionModel[]> {
    return (await this.repo.find({ order: { createdAt: 'ASC' } })).map(toVersion);
  }

  async create(data: NewCatalogVersion): Promise<CatalogVersionModel> {
    return toVersion(await this.repo.save(this.repo.create(data)));
  }

  async rename(id: string, name: string): Promise<CatalogVersionModel> {
    await this.repo.update({ id }, { name });
    return toVersion(await this.repo.findOneByOrFail({ id }));
  }

  async setBaseline(id: string, itemCode: string | null): Promise<void> {
    await this.repo.update({ id }, { baselineItemCode: itemCode });
  }

  async approve(id: string, approvedBy: string, approvedAt: Date, effectiveFrom: Date): Promise<void> {
    await this.repo.update({ id }, { status: 'APPROVED', approvedBy, approvedAt, effectiveFrom });
  }
}

@Injectable()
export class TypeOrmCatalogTaskRepository extends CatalogTaskRepository {
  constructor(@InjectRepository(CatalogTaskEntity) private readonly repo: Repository<CatalogTaskEntity>) {
    super();
  }

  async findById(id: string): Promise<CatalogTaskModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toTask(row) : null;
  }

  async findByVersion(versionId: string): Promise<CatalogTaskModel[]> {
    return (await this.repo.find({ where: { versionId }, order: { groupCode: 'ASC', sortOrder: 'ASC', name: 'ASC' } })).map(toTask);
  }

  async create(data: NewCatalogTask): Promise<CatalogTaskModel> {
    return toTask(await this.repo.save(this.repo.create(data)));
  }

  countByGroup(groupCode: string): Promise<number> {
    return this.repo.countBy({ groupCode });
  }

  async update(id: string, patch: CatalogTaskPatch): Promise<CatalogTaskModel> {
    await this.repo.update({ id }, patch);
    return toTask(await this.repo.findOneByOrFail({ id }));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

@Injectable()
export class TypeOrmCatalogScopeRepository extends CatalogScopeRepository {
  constructor(@InjectRepository(CatalogItemScopeEntity) private readonly repo: Repository<CatalogItemScopeEntity>) {
    super();
  }

  async findByVersion(versionId: string): Promise<CatalogScopeRow[]> {
    const rows = await this.repo
      .createQueryBuilder('s')
      .innerJoin(CatalogItemEntity, 'i', 'i.id = s.itemId')
      .where('i.versionId = :versionId', { versionId })
      .getMany();
    return rows.map((r) => ({ itemId: r.itemId, unitId: r.unitId, positionId: r.positionId }));
  }

  async replace(itemIds: readonly string[], scope: CatalogScope): Promise<void> {
    if (itemIds.length === 0) return;
    await this.repo.manager.transaction(async (m) => {
      const repo = m.getRepository(CatalogItemScopeEntity);
      await repo.delete({ itemId: In([...itemIds]) });
      const rows = itemIds.flatMap((itemId) => [
        ...scope.unitIds.map((unitId) => repo.create({ itemId, unitId, positionId: null })),
        ...scope.positionIds.map((positionId) => repo.create({ itemId, unitId: null, positionId })),
      ]);
      if (rows.length > 0) await repo.insert(rows);
    });
  }

  async createMany(rows: readonly CatalogScopeRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.repo.insert(rows.map((r) => this.repo.create(r)));
  }
}

@Injectable()
export class TypeOrmCatalogItemRepository extends CatalogItemRepository {
  constructor(@InjectRepository(CatalogItemEntity) private readonly repo: Repository<CatalogItemEntity>) {
    super();
  }

  async findById(id: string): Promise<CatalogItemModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toItem(row) : null;
  }

  async findByVersion(versionId: string): Promise<CatalogItemModel[]> {
    return (await this.repo.find({ where: { versionId }, order: { sortOrder: 'ASC', code: 'ASC' } })).map(toItem);
  }

  async create(data: NewCatalogItem): Promise<CatalogItemModel> {
    return toItem(await this.repo.save(this.repo.create(data)));
  }

  countByGroup(groupCode: string): Promise<number> {
    return this.repo.countBy({ groupCode });
  }

  async update(id: string, patch: CatalogItemPatch): Promise<CatalogItemModel> {
    await this.repo.update({ id }, patch);
    return toItem(await this.repo.findOneByOrFail({ id }));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

const toVersion = (e: CatalogVersionEntity): CatalogVersionModel => ({
  id: e.id,
  name: e.name,
  label: e.label,
  status: e.status,
  baselineItemCode: e.baselineItemCode,
  effectiveFrom: e.effectiveFrom,
  approvedAt: e.approvedAt,
  approvedBy: e.approvedBy,
  sourceNote: e.sourceNote,
});

const toTask = (e: CatalogTaskEntity): CatalogTaskModel => ({
  id: e.id,
  versionId: e.versionId,
  groupCode: e.groupCode,
  name: e.name,
  description: e.description,
  sortOrder: e.sortOrder,
});

const toItem = (e: CatalogItemEntity): CatalogItemModel => ({
  id: e.id,
  versionId: e.versionId,
  taskId: e.taskId,
  code: e.code,
  groupCode: e.groupCode,
  name: e.name,
  productUnits: e.productUnits,
  complexity: e.complexity,
  durationMode: e.durationMode,
  durationValue: e.durationValue,
  durationUnit: e.durationUnit,
  points: e.points,
  explanation: e.explanation,
  sortOrder: e.sortOrder,
});
