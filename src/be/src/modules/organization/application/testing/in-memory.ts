import { Test } from '@nestjs/testing';
import { Clock } from '../../../../common/clock.js';
import { AccountService, AuditService } from '../../../security/index.js';
import { AssignmentService } from '../assignment.service.js';
import { OrgImportService } from '../org-import.service.js';
import { OrgQueryService } from '../org-query.service.js';
import type {
  AssignmentModel,
  NewAssignment,
  NewPerson,
  NewPosition,
  PersonModel,
  PersonPatch,
  PositionModel,
  PositionPatch,
} from '../org.model.js';
import { defaultIsLeader, EMPTY_PROFILE } from '../org.model.js';
import { AssignmentRepository, PersonRepository, PositionRepository } from '../org.ports.js';
import { PersonService } from '../person.service.js';
import { PositionService } from '../position.service.js';
import type { NewUnit, UnitModel, UnitPatch } from '../unit.model.js';
import { UnitRepository } from '../unit.repository.js';
import { UnitService } from '../unit.service.js';

/** Đối tượng giả dùng chung cho test lớp nghiệp vụ của mô-đun organization. */

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

export class InMemoryUnits extends UnitRepository {
  rows: UnitModel[] = [];
  async findAll() {
    return [...this.rows];
  }
  async findById(id: string) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async findByCode(code: string) {
    return this.rows.find((u) => u.code === code) ?? null;
  }
  async create(data: NewUnit) {
    const row = { ...data, id: nextId('u') };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: UnitPatch) {
    const row = this.rows.find((u) => u.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  /** Đơn vị "có vị trí" khi test đặt vào `inUse`. */
  inUse = new Set<string>();
  async delete(id: string): Promise<'OK' | 'IN_USE'> {
    if (this.inUse.has(id)) return 'IN_USE';
    this.rows = this.rows.filter((u) => u.id !== id);
    return 'OK';
  }
}

export class InMemoryPersons extends PersonRepository {
  rows: PersonModel[] = [];
  async findById(id: string) {
    return this.rows.find((p) => p.id === id) ?? null;
  }
  async findAll(filter?: { active?: boolean }) {
    return this.rows.filter((p) => filter?.active === undefined || p.active === filter.active);
  }
  async findByFullName(fullName: string) {
    return this.rows.filter((p) => p.fullName === fullName);
  }
  async findByEmployeeCode(code: string) {
    return this.rows.find((p) => p.employeeCode?.toUpperCase() === code.toUpperCase()) ?? null;
  }
  async findByNationalId(nationalId: string) {
    return this.rows.find((p) => p.nationalId === nationalId) ?? null;
  }
  async create(data: NewPerson) {
    const row: PersonModel = { ...EMPTY_PROFILE, ...data, id: nextId('p'), active: true };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: PersonPatch) {
    const row = this.rows.find((p) => p.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  async setActive(id: string, active: boolean) {
    this.rows.find((p) => p.id === id)!.active = active;
  }
}

export class InMemoryPositions extends PositionRepository {
  rows: PositionModel[] = [];
  async findById(id: string) {
    return this.rows.find((p) => p.id === id) ?? null;
  }
  async findByCode(code: string) {
    return this.rows.find((p) => p.code === code) ?? null;
  }
  async findAll(filter?: { unitId?: string }) {
    return this.rows.filter((p) => !filter?.unitId || p.unitId === filter.unitId);
  }
  async create(data: NewPosition) {
    const row: PositionModel = { ...data, isLeader: data.isLeader ?? defaultIsLeader(data.level), id: nextId('pos') };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: PositionPatch) {
    const row = this.rows.find((p) => p.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  inUse = new Set<string>();
  async delete(id: string): Promise<'OK' | 'IN_USE'> {
    if (this.inUse.has(id)) return 'IN_USE';
    this.rows = this.rows.filter((p) => p.id !== id);
    return 'OK';
  }
}

export class InMemoryAssignments extends AssignmentRepository {
  rows: AssignmentModel[] = [];
  async findById(id: string) {
    return this.rows.find((a) => a.id === id) ?? null;
  }
  async findAll() {
    return [...this.rows];
  }
  async findByPerson(personId: string) {
    return this.rows.filter((a) => a.personId === personId);
  }
  async findByPosition(positionId: string) {
    return this.rows.filter((a) => a.positionId === positionId);
  }
  async create(data: NewAssignment) {
    const row = { ...data, id: nextId('as') };
    this.rows.push(row);
    return row;
  }
  async end(id: string, at: Date) {
    this.rows.find((a) => a.id === id)!.validTo = at;
  }
}

/** Giả của AccountService phía security: chỉ các hàm mà PersonService dùng. */
export class FakeAccounts {
  links = new Map<string, string>(); // accountId -> personId
  async linkPerson(accountId: string, personId: string) {
    this.links.set(accountId, personId);
  }
  async unlinkPerson(accountId: string) {
    this.links.delete(accountId);
  }
  async findByPersonId(personId: string) {
    const entry = [...this.links].find(([, p]) => p === personId);
    return entry ? { id: entry[0], username: 'x', personId } : null;
  }
}

export async function buildOrg() {
  const clock = new FakeClock();
  const audit: { action: string; details?: Record<string, unknown> }[] = [];
  const accounts = new FakeAccounts();
  const repos = {
    units: new InMemoryUnits(),
    persons: new InMemoryPersons(),
    positions: new InMemoryPositions(),
    assignments: new InMemoryAssignments(),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      UnitService,
      PersonService,
      PositionService,
      AssignmentService,
      OrgQueryService,
      OrgImportService,
      { provide: Clock, useValue: clock },
      { provide: UnitRepository, useValue: repos.units },
      { provide: PersonRepository, useValue: repos.persons },
      { provide: PositionRepository, useValue: repos.positions },
      { provide: AssignmentRepository, useValue: repos.assignments },
      { provide: AuditService, useValue: { record: async (e: { action: string }) => void audit.push(e) } },
      { provide: AccountService, useValue: accounts },
    ],
  }).compile();

  return {
    clock,
    audit,
    accounts,
    repos,
    units: moduleRef.get(UnitService),
    persons: moduleRef.get(PersonService),
    positions: moduleRef.get(PositionService),
    assignments: moduleRef.get(AssignmentService),
    query: moduleRef.get(OrgQueryService),
    importer: moduleRef.get(OrgImportService),
  };
}

export type Org = Awaited<ReturnType<typeof buildOrg>>;

/** Ban + phòng và chuỗi 1 → 2 → 3 → 4 → 5 để thử các quy tắc cây. */
export async function seedChain(org: Org) {
  const ban = await org.units.create({ code: 'BTCTU', name: 'Ban', type: 'BAN', parentId: null });
  const mk = (level: number, reportsTo: PositionModel | null) =>
    org.positions.create({
      code: `BTCTU-L${level}-A`,
      unitId: ban.id,
      title: `Cấp ${level}`,
      level,
      reportsToPositionId: reportsTo?.id ?? null,
      duties: null,
      referenceOkr: null,
    });
  const l1 = await mk(1, null);
  const l2 = await mk(2, l1);
  const l3 = await mk(3, l2);
  const l4 = await mk(4, l3);
  const l5 = await mk(5, l4);
  return { ban, l1, l2, l3, l4, l5 };
}
