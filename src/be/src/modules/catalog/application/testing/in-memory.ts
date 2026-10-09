import { Test } from '@nestjs/testing';
import { Clock } from '../../../../common/clock.js';
import { AuditService } from '../../../security/index.js';
import { CatalogImportService } from '../catalog-import.service.js';
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
} from '../catalog.model.js';
import { CatalogGroupRepository, CatalogItemRepository, CatalogScopeRepository, CatalogTaskRepository, CatalogVersionRepository, OrgDirectory } from '../catalog.ports.js';
import { CatalogService } from '../catalog.service.js';

/** Đối tượng giả dùng chung cho test lớp nghiệp vụ của mô-đun catalog. */

export class FakeClock extends Clock {
  current = new Date('2026-10-03T08:00:00Z');
  now() {
    return new Date(this.current);
  }
  advanceDays(d: number) {
    this.current = new Date(this.current.getTime() + d * 86_400_000);
  }
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

export class InMemoryGroups extends CatalogGroupRepository {
  rows: CatalogGroupModel[] = ['A', 'B', 'C', 'D'].map((code, i) => ({ code, name: `Nhóm ${code}`, sortOrder: i + 1 }));
  async findAll() {
    return [...this.rows];
  }
  async findByCode(code: string) {
    return this.rows.find((g) => g.code === code) ?? null;
  }
  async upsert(group: CatalogGroupModel) {
    const i = this.rows.findIndex((g) => g.code === group.code);
    if (i >= 0) this.rows[i] = group;
    else this.rows.push(group);
  }
  async rename(code: string, name: string) {
    const row = this.rows.find((g) => g.code === code)!;
    row.name = name;
    return row;
  }
  async delete(code: string) {
    this.rows = this.rows.filter((g) => g.code !== code);
  }
}

export class InMemoryVersions extends CatalogVersionRepository {
  rows: CatalogVersionModel[] = [];
  async findById(id: string) {
    return this.rows.find((v) => v.id === id) ?? null;
  }
  async findByLabel(label: string) {
    return this.rows.find((v) => v.label === label) ?? null;
  }
  async findAll() {
    return [...this.rows];
  }
  async create(data: NewCatalogVersion) {
    const row: CatalogVersionModel = {
      ...data,
      id: nextId('v'),
      status: 'DRAFT',
      effectiveFrom: null,
      approvedAt: null,
      approvedBy: null,
    };
    this.rows.push(row);
    return row;
  }
  async rename(id: string, name: string) {
    const row = this.rows.find((v) => v.id === id)!;
    row.name = name;
    return row;
  }
  async setBaseline(id: string, itemCode: string | null) {
    this.rows.find((v) => v.id === id)!.baselineItemCode = itemCode;
  }
  async approve(id: string, approvedBy: string, approvedAt: Date, effectiveFrom: Date) {
    Object.assign(this.rows.find((v) => v.id === id)!, { status: 'APPROVED', approvedBy, approvedAt, effectiveFrom });
  }
}

export class InMemoryTasks extends CatalogTaskRepository {
  rows: CatalogTaskModel[] = [];
  async findById(id: string) {
    return this.rows.find((t) => t.id === id) ?? null;
  }
  async findByVersion(versionId: string) {
    return this.rows.filter((t) => t.versionId === versionId);
  }
  async create(data: NewCatalogTask) {
    const row = { ...data, id: nextId('t') };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: CatalogTaskPatch) {
    const row = this.rows.find((t) => t.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  async delete(id: string) {
    this.rows = this.rows.filter((t) => t.id !== id);
  }
  async countByGroup(groupCode: string) {
    return this.rows.filter((t) => t.groupCode === groupCode).length;
  }
}

export class InMemoryItems extends CatalogItemRepository {
  rows: CatalogItemModel[] = [];
  async findById(id: string) {
    return this.rows.find((i) => i.id === id) ?? null;
  }
  async findByVersion(versionId: string) {
    return this.rows.filter((i) => i.versionId === versionId);
  }
  async create(data: NewCatalogItem) {
    const row = { ...data, id: nextId('i') };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: CatalogItemPatch) {
    const row = this.rows.find((i) => i.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  async delete(id: string) {
    this.rows = this.rows.filter((i) => i.id !== id);
  }
  async countByGroup(groupCode: string) {
    return this.rows.filter((i) => i.groupCode === groupCode).length;
  }
}

export class InMemoryScopes extends CatalogScopeRepository {
  rows: CatalogScopeRow[] = [];
  constructor(private readonly items: InMemoryItems) {
    super();
  }
  async findByVersion(versionId: string) {
    const ids = new Set(this.items.rows.filter((i) => i.versionId === versionId).map((i) => i.id));
    return this.rows.filter((r) => ids.has(r.itemId));
  }
  async replace(itemIds: readonly string[], scope: CatalogScope) {
    this.rows = this.rows.filter((r) => !itemIds.includes(r.itemId));
    for (const itemId of itemIds) {
      for (const unitId of scope.unitIds) this.rows.push({ itemId, unitId, positionId: null });
      for (const positionId of scope.positionIds) this.rows.push({ itemId, unitId: null, positionId });
    }
  }
  async createMany(rows: readonly CatalogScopeRow[]) {
    this.rows.push(...rows);
  }
}

/** Đơn vị, vị trí giả: mã nào có trong hai tập này thì "tồn tại". */
export class FakeOrgDirectory extends OrgDirectory {
  units = new Set<string>(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']);
  positions = new Set<string>(['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2']);
  async unitIds() {
    return this.units;
  }
  async positionIds() {
    return this.positions;
  }
}

export async function buildCatalog() {
  const clock = new FakeClock();
  const audit: { action: string; details?: Record<string, unknown> }[] = [];
  const items = new InMemoryItems();
  const repos = { groups: new InMemoryGroups(), versions: new InMemoryVersions(), tasks: new InMemoryTasks(), items, scopes: new InMemoryScopes(items) };
  const org = new FakeOrgDirectory();
  const moduleRef = await Test.createTestingModule({
    providers: [
      CatalogService,
      CatalogImportService,
      { provide: Clock, useValue: clock },
      { provide: CatalogGroupRepository, useValue: repos.groups },
      { provide: CatalogVersionRepository, useValue: repos.versions },
      { provide: CatalogTaskRepository, useValue: repos.tasks },
      { provide: CatalogItemRepository, useValue: repos.items },
      { provide: CatalogScopeRepository, useValue: repos.scopes },
      { provide: OrgDirectory, useValue: org },
      { provide: AuditService, useValue: { record: async (e: { action: string }) => void audit.push(e) } },
    ],
  }).compile();
  return {
    clock,
    audit,
    repos,
    org,
    catalog: moduleRef.get(CatalogService),
    importer: moduleRef.get(CatalogImportService),
  };
}

export type Catalog = Awaited<ReturnType<typeof buildCatalog>>;

export const approver = { id: 'acc-truong-ban' };

/** Một phiên bản nháp có công việc chuẩn B.009 (90 điểm) và vài công việc khác. */
export async function seedDraft(c: Catalog, label = 'Bản nháp thử') {
  const version = await c.catalog.createVersion({ label });
  const add = (code: string, points: number | null, complexity = 2) =>
    c.catalog.addItem(version.id, {
      code,
      name: `Công việc ${code}`,
      complexity,
      durationMode: 'LIMITED',
      durationValue: 4,
      durationUnit: 'HOUR',
      points,
    });
  const items = {
    baseline: await add('B.009', 90),
    a3: await add('A.003', 120, 3),
    light: await add('B.001', 5, 1),
    unscored: await add('A.007', null, 3),
  };
  await c.catalog.setBaseline(version.id, 'B.009');
  return { version, items };
}
