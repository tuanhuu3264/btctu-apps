import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../security/index.js';
import { EvaluationRepository, PeriodRepository } from './evaluation.ports.js';
import type { PeriodModel } from './evaluation.model.js';
import type { Actor } from './evaluation.service.js';
import { GeneralCriteriaRepository, validateSet } from './general-criteria.js';
import type { GeneralCriteriaSet, GeneralCriteriaVersion } from './general-criteria.js';

export interface GeneralCriteriaVersionView extends GeneralCriteriaVersion {
  /** Ngày cuối áp dụng (trước phiên bản kế tiếp); null nếu là phiên bản mới nhất. */
  effectiveTo: string | null;
  /** Các kỳ tháng, quý đã có người tự chấm theo phiên bản này: phiên bản không xóa được nữa. */
  usedBy: string[];
}

export interface NewCriteriaInput {
  /** Tháng bắt đầu áp dụng, dạng YYYY-MM. */
  effectiveFrom: string;
  leader: GeneralCriteriaSet;
  staff: GeneralCriteriaSet;
  note?: string | null;
}

/**
 * Bảng tiêu chí chung 30 điểm của cá nhân theo phiên bản (ADR-054). Mỗi phiên bản áp dụng từ một tháng. Chỉ được thêm phiên bản
 * từ tháng mà chưa kỳ tháng, quý nào từ đó trở đi có người tự chấm, để mọi người trong cùng một kỳ chấm theo cùng một bảng.
 */
@Injectable()
export class GeneralCriteriaService {
  constructor(
    private readonly criteria: GeneralCriteriaRepository,
    private readonly periods: PeriodRepository,
    private readonly evaluations: EvaluationRepository,
    private readonly audit: AuditService,
  ) {}

  /** Mọi phiên bản, mới nhất trước. */
  async list(): Promise<GeneralCriteriaVersionView[]> {
    const versions = await this.criteria.findAll();
    const used = await this.usedPeriods();
    return versions
      .map((v, i) => {
        const next = versions[i + 1]?.effectiveFrom ?? null;
        return { ...v, effectiveTo: next ? dayBefore(next) : null, usedBy: used.filter((p) => p.startDate >= v.effectiveFrom && (!next || p.startDate < next)).map((p) => p.label) };
      })
      .reverse();
  }

  async create(actor: Actor, input: NewCriteriaInput): Promise<GeneralCriteriaVersion> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.effectiveFrom ?? '')) throw new BadRequestException('Tháng bắt đầu áp dụng có dạng YYYY-MM');
    const effectiveFrom = `${input.effectiveFrom}-01`;
    const leader = validateSet(input.leader, 'Bảng lãnh đạo, quản lý');
    const staff = validateSet(input.staff, 'Bảng công chức không giữ chức vụ');
    if ((await this.criteria.findAll()).some((v) => v.effectiveFrom === effectiveFrom)) {
      throw new ConflictException(`Đã có phiên bản áp dụng từ tháng ${input.effectiveFrom}; xóa phiên bản đó trước nếu chưa dùng`);
    }
    const blocked = (await this.usedPeriods()).filter((p) => p.startDate >= effectiveFrom).map((p) => p.label);
    if (blocked.length > 0) {
      throw new ConflictException(`Các kỳ ${blocked.join(', ')} đã có người tự chấm theo bảng hiện hành; chỉ áp dụng bảng mới từ tháng sau các kỳ đó`);
    }
    const created = await this.criteria.create({ effectiveFrom, leader, staff, note: input.note?.trim() || null, createdBy: actor.id });
    await this.audit.record({
      action: 'evaluation.general-criteria.create',
      outcome: 'SUCCESS',
      targetType: 'general_criteria_version',
      targetId: created.id,
      details: { effectiveFrom, leaderItems: leader.items.length, staffItems: staff.items.length, note: created.note },
    });
    return created;
  }

  /** Xóa phiên bản chưa có ai tự chấm theo; các kỳ của nó trở về phiên bản trước đó. */
  async remove(actor: Actor, id: string): Promise<void> {
    const view = (await this.list()).find((v) => v.id === id);
    if (!view) throw new NotFoundException(`Không tìm thấy phiên bản bảng tiêu chí chung: ${id}`);
    if (view.usedBy.length > 0) throw new ConflictException(`Phiên bản đã được dùng để chấm các kỳ ${view.usedBy.join(', ')}, không xóa được`);
    await this.criteria.delete(id);
    await this.audit.record({
      action: 'evaluation.general-criteria.delete',
      outcome: 'SUCCESS',
      targetType: 'general_criteria_version',
      targetId: id,
      details: { effectiveFrom: view.effectiveFrom },
    });
  }

  /** Kỳ tháng, quý đã có hồ sơ được tự chấm (kể cả hồ sơ sau đó bị trả lại). */
  private async usedPeriods(): Promise<PeriodModel[]> {
    const out: PeriodModel[] = [];
    for (const p of await this.periods.findAll()) {
      if (p.type === 'YEAR') continue;
      const rows = await this.evaluations.findByPeriod(p.id);
      if (rows.some((e) => e.selfSubmittedAt !== null || e.status !== 'PLANNED')) out.push(p);
    }
    return out.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
