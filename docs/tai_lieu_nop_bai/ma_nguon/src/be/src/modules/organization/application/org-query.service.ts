import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { isCurrent, overlaps } from './org.model.js';
import type { AssignmentKind, PositionModel } from './org.model.js';
import { AssignmentRepository, PersonRepository, PositionRepository } from './org.ports.js';
import { UnitService } from './unit.service.js';
import { parseOkr } from './okr-parser.js';
import type { ParsedOkr } from './okr-parser.js';

export interface OrgTreePosition {
  id: string;
  code: string;
  title: string;
  level: number;
  isLeader: boolean;
  isSupport: boolean;
  reportsToPositionId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  inactiveReason: string | null;
  /** `kind`: người này giữ vị trí này là vị trí chính hay kiêm nhiệm (ADR-047). */
  holder: { personId: string; fullName: string; kind: AssignmentKind } | null;
}

/** Một vị trí cấp trên và người đang giữ (null nếu vị trí đang trống). */
export interface OrgSuperior {
  positionId: string;
  level: number;
  personId: string | null;
}

/** Bảng tra cứu tên cán bộ và thông tin vị trí, đơn vị, dùng cho báo cáo. */
export interface OrgLookupData {
  persons: Map<string, { fullName: string }>;
  positions: Map<string, { title: string; level: number; unitCode: string; unitName: string }>;
  units: Map<string, { code: string; name: string }>;
}

export interface OrgTreeUnit {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  inactiveReason: string | null;
  positions: OrgTreePosition[];
}

/** Dựng sơ đồ tổ chức hiện tại: đơn vị, các vị trí và người đang giữ. */
@Injectable()
export class OrgQueryService {
  constructor(
    private readonly units: UnitService,
    private readonly positions: PositionRepository,
    private readonly persons: PersonRepository,
    private readonly assignments: AssignmentRepository,
    private readonly clock: Clock,
  ) {}

  /** Vị trí chính mà cán bộ đang giữ (không tính kiêm nhiệm), hoặc null nếu hiện không giữ vị trí nào. */
  async currentPositionOf(personId: string): Promise<PositionModel | null> {
    return (await this.currentPlacementsOf(personId)).find((p) => p.kind === 'PRIMARY')?.position ?? null;
  }

  positionById(positionId: string): Promise<PositionModel | null> {
    return this.positions.findById(positionId);
  }

  /** Mọi vị trí cán bộ đang giữ, vị trí chính trước rồi đến các vị trí kiêm nhiệm (ADR-047). */
  async currentPlacementsOf(personId: string): Promise<{ position: PositionModel; kind: AssignmentKind; assignmentId: string }[]> {
    const now = this.clock.now();
    const current = (await this.assignments.findByPerson(personId)).filter((a) => isCurrent(a, now));
    current.sort((a, b) => (a.kind === b.kind ? a.validFrom.getTime() - b.validFrom.getTime() : a.kind === 'PRIMARY' ? -1 : 1));
    const placements: { position: PositionModel; kind: AssignmentKind; assignmentId: string }[] = [];
    for (const a of current) {
      const position = await this.positions.findById(a.positionId);
      if (position) placements.push({ position, kind: a.kind, assignmentId: a.id });
    }
    return placements;
  }

  /**
   * Các vị trí cán bộ có giữ trong khoảng [from, to] (chỉ cần giao nhau, không xét số ngày; đã chốt cho kiêm nhiệm).
   * Vị trí chính trước.
   */
  async placementsDuring(personId: string, from: Date, to: Date): Promise<{ position: PositionModel; kind: AssignmentKind; assignmentId: string }[]> {
    const held = (await this.assignments.findByPerson(personId)).filter((a) => overlaps(a, { validFrom: from, validTo: new Date(to.getTime() + 1) }));
    held.sort((a, b) => (a.kind === b.kind ? a.validFrom.getTime() - b.validFrom.getTime() : a.kind === 'PRIMARY' ? -1 : 1));
    const placements: { position: PositionModel; kind: AssignmentKind; assignmentId: string }[] = [];
    for (const a of held) {
      const position = await this.positions.findById(a.positionId);
      if (position) placements.push({ position, kind: a.kind, assignmentId: a.id });
    }
    return placements;
  }

  /** Mục tiêu và kết quả then chốt (cột OKR) của vị trí cán bộ đang giữ; null nếu không giữ vị trí hoặc vị trí không có OKR. */
  async okrOf(personId: string): Promise<ParsedOkr | null> {
    return parseOkr((await this.currentPositionOf(personId))?.referenceOkr);
  }

  /**
   * Chuỗi vị trí cấp trên của cán bộ, từ cấp trên trực tiếp lên đến gốc, kèm người đang giữ từng vị trí.
   * Nêu `positionId` thì tính từ chính vị trí đó (cán bộ kiêm nhiệm có chuỗi cấp trên riêng cho từng vị trí);
   * không nêu thì tính từ vị trí chính.
   */
  async superiorsOf(personId: string, positionId?: string): Promise<OrgSuperior[]> {
    const position = positionId ? await this.positions.findById(positionId) : await this.currentPositionOf(personId);
    if (!position) return [];
    const now = this.clock.now();
    const [all, assignments] = await Promise.all([this.positions.findAll(), this.assignments.findAll()]);
    const byId = new Map(all.map((p) => [p.id, p]));
    const holderOf = new Map(assignments.filter((a) => isCurrent(a, now)).map((a) => [a.positionId, a.personId]));

    const chain: OrgSuperior[] = [];
    let next = position.reportsToPositionId ? byId.get(position.reportsToPositionId) : undefined;
    while (next) {
      chain.push({ positionId: next.id, level: next.level, personId: holderOf.get(next.id) ?? null });
      next = next.reportsToPositionId ? byId.get(next.reportsToPositionId) : undefined;
    }
    return chain;
  }

  /**
   * Những người đang giữ các vị trí cấp dưới của cán bộ: trực tiếp hoặc ở mọi cấp. Vị trí trống bị bỏ qua
   * nhưng vẫn được đi qua để tìm tiếp các cấp dưới của nó. Nêu `positionId` thì chỉ tính các cấp dưới của vị trí đó;
   * không nêu thì hợp các cấp dưới của mọi vị trí cán bộ đang giữ (kể cả kiêm nhiệm), mỗi người một lần.
   */
  async subordinateHolders(personId: string, options: { direct: boolean; positionId?: string }): Promise<string[]> {
    const roots = options.positionId ? [options.positionId] : (await this.currentPlacementsOf(personId)).map((p) => p.position.id);
    if (roots.length === 0) return [];
    const now = this.clock.now();
    const [all, assignments] = await Promise.all([this.positions.findAll(), this.assignments.findAll()]);
    const holderOf = new Map(assignments.filter((a) => isCurrent(a, now)).map((a) => [a.positionId, a.personId]));

    const holders = new Set<string>();
    let frontier = roots;
    const visited = new Set<string>(roots);
    while (frontier.length > 0) {
      const children = all.filter((p) => p.reportsToPositionId !== null && frontier.includes(p.reportsToPositionId) && !visited.has(p.id));
      for (const child of children) {
        visited.add(child.id);
        const holder = holderOf.get(child.id);
        if (holder && holder !== personId) holders.add(holder);
      }
      frontier = options.direct ? [] : children.map((c) => c.id);
    }
    return [...holders];
  }

  async lookup(): Promise<OrgLookupData> {
    const [units, positions, persons] = await Promise.all([this.units.list(), this.positions.findAll(), this.persons.findAll()]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    return {
      persons: new Map(persons.map((p) => [p.id, { fullName: p.fullName }])),
      units: new Map(units.map((u) => [u.id, { code: u.code, name: u.name }])),
      positions: new Map(
        positions.map((p) => {
          const unit = unitById.get(p.unitId);
          return [p.id, { title: p.title, level: p.level, unitCode: unit?.code ?? '?', unitName: unit?.name ?? '?' }];
        }),
      ),
    };
  }

  async tree(options: { includeInactive?: boolean } = {}): Promise<OrgTreeUnit[]> {
    const now = this.clock.now();
    const [units, positions, persons, assignments] = await Promise.all([
      options.includeInactive ? this.units.list() : this.units.listActive(),
      options.includeInactive ? this.positions.findAll() : this.positions.findAll().then((all) => all.filter((p) => p.status === 'ACTIVE')),
      this.persons.findAll(),
      this.assignments.findAll(),
    ]);
    const personById = new Map(persons.map((p) => [p.id, p]));
    const holderByPosition = new Map(
      assignments.filter((a) => isCurrent(a, now)).map((a) => [a.positionId, { person: personById.get(a.personId), kind: a.kind }] as const),
    );

    return units.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      type: u.type,
      parentId: u.parentId,
      status: u.status,
      inactiveReason: u.inactiveReason,
      positions: positions
        .filter((p) => p.unitId === u.id)
        .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))
        .map((p) => {
          const holder = holderByPosition.get(p.id);
          return {
            id: p.id,
            code: p.code,
            title: p.title,
            level: p.level,
            isLeader: p.isLeader,
            isSupport: p.isSupport,
            reportsToPositionId: p.reportsToPositionId,
            status: p.status,
            inactiveReason: p.inactiveReason,
            holder: holder?.person ? { personId: holder.person.id, fullName: holder.person.fullName, kind: holder.kind } : null,
          };
        }),
    }));
  }
}
