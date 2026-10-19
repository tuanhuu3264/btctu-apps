import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { AssignmentService } from './assignment.service.js';
import type { OrgImportPlan, PlannedPosition } from './org-import.plan.js';
import { isCurrent } from './org.model.js';
import type { PositionModel, PositionPatch } from './org.model.js';
import { PersonService } from './person.service.js';
import { PositionService } from './position.service.js';
import { UnitService } from './unit.service.js';

export interface OrgImportSummary {
  unitsCreated: number;
  personsCreated: number;
  positionsCreated: number;
  positionsUpdated: number;
  positionsUnchanged: number;
  assignmentsCreated: number;
  assignmentsUnchanged: number;
  warnings: string[];
}

/**
 * Áp dụng kế hoạch nhập vào cơ sở dữ liệu thông qua các dịch vụ nghiệp vụ, nên mọi quy tắc và nhật ký
 * vẫn áp dụng. Chạy lại nhiều lần không tạo trùng (nhận diện bằng mã đơn vị, mã vị trí, họ tên).
 * Không bọc trong một giao dịch: nếu lỗi giữa chừng, chạy lại sẽ hoàn thiện phần còn thiếu.
 */
@Injectable()
export class OrgImportService {
  constructor(
    private readonly units: UnitService,
    private readonly persons: PersonService,
    private readonly positions: PositionService,
    private readonly assignments: AssignmentService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async apply(plan: OrgImportPlan): Promise<OrgImportSummary> {
    if (plan.errors.length > 0) {
      throw new BadRequestException(`Tệp có ${plan.errors.length} lỗi:\n${plan.errors.join('\n')}`);
    }
    const summary: OrgImportSummary = {
      unitsCreated: 0,
      personsCreated: 0,
      positionsCreated: 0,
      positionsUpdated: 0,
      positionsUnchanged: 0,
      assignmentsCreated: 0,
      assignmentsUnchanged: 0,
      warnings: [],
    };

    const unitIdByCode = new Map<string, string>();
    for (const u of plan.units) {
      let unit = await this.units.findByCode(u.code);
      if (!unit) {
        unit = await this.units.create({
          code: u.code,
          name: u.name,
          type: u.type,
          parentId: u.parentCode ? (unitIdByCode.get(u.parentCode) ?? null) : null,
        });
        summary.unitsCreated++;
      }
      unitIdByCode.set(u.code, unit.id);
    }

    const personIdByName = new Map<string, string>();
    for (const name of new Set(plan.positions.map((p) => p.holderName).filter((n): n is string => n !== null))) {
      const matches = await this.persons.findByFullName(name);
      if (matches.length > 1) throw new ConflictException(`Có ${matches.length} cán bộ trùng họ tên, hãy xử lý trước: ${name}`);
      if (matches.length === 1) {
        personIdByName.set(name, matches[0].id);
      } else {
        personIdByName.set(name, (await this.persons.create({ fullName: name, note: null })).id);
        summary.personsCreated++;
      }
    }

    // Cấp trên luôn có số cấp nhỏ hơn nên xử lý theo thứ tự cấp tăng dần thì cấp trên đã tồn tại.
    const positionByCode = new Map<string, PositionModel>();
    for (const p of [...plan.positions].sort((a, b) => a.level - b.level)) {
      const unitId = unitIdByCode.get(p.unitCode)!;
      const reportsTo = p.reportsToCode ? (positionByCode.get(p.reportsToCode)?.id ?? null) : null;
      const wanted = { unitId, title: p.title, level: p.level, reportsToPositionId: reportsTo, duties: p.duties, referenceOkr: p.referenceOkr };

      const existing = await this.positions.findByCode(p.code);
      if (!existing) {
        positionByCode.set(p.code, await this.positions.create({ code: p.code, ...wanted }));
        summary.positionsCreated++;
        continue;
      }
      const patch = diff(existing, wanted);
      if (Object.keys(patch).length === 0) {
        positionByCode.set(p.code, existing);
        summary.positionsUnchanged++;
      } else {
        positionByCode.set(p.code, await this.positions.update(existing.id, patch));
        summary.positionsUpdated++;
      }
    }

    const now = this.clock.now();
    const current = (await this.assignments.list()).filter((a) => isCurrent(a, now));
    for (const p of plan.positions) await this.assignHolder(p, positionByCode, personIdByName, current, summary);

    await this.audit.record({ action: 'org.import', outcome: 'SUCCESS', details: { ...summary, warnings: summary.warnings.length } });
    return summary;
  }

  private async assignHolder(
    p: PlannedPosition,
    positionByCode: Map<string, PositionModel>,
    personIdByName: Map<string, string>,
    current: { personId: string; positionId: string }[],
    summary: OrgImportSummary,
  ): Promise<void> {
    if (!p.holderName) return;
    const positionId = positionByCode.get(p.code)!.id;
    const personId = personIdByName.get(p.holderName)!;
    if (current.some((a) => a.personId === personId && a.positionId === positionId)) {
      summary.assignmentsUnchanged++;
      return;
    }
    try {
      current.push(await this.assignments.assign(positionId, personId));
      summary.assignmentsCreated++;
    } catch (e) {
      if (!(e instanceof ConflictException)) throw e;
      summary.warnings.push(`Không phân công được cho vị trí ${p.code}: ${e.message}`);
    }
  }
}

function diff(existing: PositionModel, wanted: PositionPatch): PositionPatch {
  const patch: PositionPatch = {};
  for (const key of Object.keys(wanted) as (keyof PositionPatch)[]) {
    if (existing[key] !== wanted[key]) (patch as Record<string, unknown>)[key] = wanted[key];
  }
  return patch;
}
