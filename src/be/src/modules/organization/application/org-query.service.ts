import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { isCurrent } from './org.model.js';
import type { PositionModel } from './org.model.js';
import { AssignmentRepository, PersonRepository, PositionRepository } from './org.ports.js';
import { UnitService } from './unit.service.js';

export interface OrgTreePosition {
  id: string;
  code: string;
  title: string;
  level: number;
  isLeader: boolean;
  reportsToPositionId: string | null;
  holder: { personId: string; fullName: string } | null;
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
}

export interface OrgTreeUnit {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
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

  /** Vị trí mà cán bộ đang giữ, hoặc null nếu hiện không giữ vị trí nào. */
  async currentPositionOf(personId: string): Promise<PositionModel | null> {
    const now = this.clock.now();
    const current = (await this.assignments.findByPerson(personId)).find((a) => isCurrent(a, now));
    return current ? this.positions.findById(current.positionId) : null;
  }

  /** Chuỗi vị trí cấp trên của cán bộ, từ cấp trên trực tiếp lên đến gốc, kèm người đang giữ từng vị trí. */
  async superiorsOf(personId: string): Promise<OrgSuperior[]> {
    const position = await this.currentPositionOf(personId);
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
   * nhưng vẫn được đi qua để tìm tiếp các cấp dưới của nó.
   */
  async subordinateHolders(personId: string, options: { direct: boolean }): Promise<string[]> {
    const position = await this.currentPositionOf(personId);
    if (!position) return [];
    const now = this.clock.now();
    const [all, assignments] = await Promise.all([this.positions.findAll(), this.assignments.findAll()]);
    const holderOf = new Map(assignments.filter((a) => isCurrent(a, now)).map((a) => [a.positionId, a.personId]));

    const holders: string[] = [];
    let frontier = [position.id];
    while (frontier.length > 0) {
      const children = all.filter((p) => p.reportsToPositionId !== null && frontier.includes(p.reportsToPositionId));
      for (const child of children) {
        const holder = holderOf.get(child.id);
        if (holder) holders.push(holder);
      }
      frontier = options.direct ? [] : children.map((c) => c.id);
    }
    return holders;
  }

  async lookup(): Promise<OrgLookupData> {
    const [units, positions, persons] = await Promise.all([this.units.list(), this.positions.findAll(), this.persons.findAll()]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    return {
      persons: new Map(persons.map((p) => [p.id, { fullName: p.fullName }])),
      positions: new Map(
        positions.map((p) => {
          const unit = unitById.get(p.unitId);
          return [p.id, { title: p.title, level: p.level, unitCode: unit?.code ?? '?', unitName: unit?.name ?? '?' }];
        }),
      ),
    };
  }

  async tree(): Promise<OrgTreeUnit[]> {
    const now = this.clock.now();
    const [units, positions, persons, assignments] = await Promise.all([
      this.units.list(),
      this.positions.findAll(),
      this.persons.findAll(),
      this.assignments.findAll(),
    ]);
    const personById = new Map(persons.map((p) => [p.id, p]));
    const holderByPosition = new Map(
      assignments.filter((a) => isCurrent(a, now)).map((a) => [a.positionId, personById.get(a.personId)]),
    );

    return units.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      type: u.type,
      parentId: u.parentId,
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
            reportsToPositionId: p.reportsToPositionId,
            holder: holder ? { personId: holder.id, fullName: holder.fullName } : null,
          };
        }),
    }));
  }
}
