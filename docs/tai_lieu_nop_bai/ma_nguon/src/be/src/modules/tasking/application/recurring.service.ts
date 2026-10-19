import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { addDaysIso, firstOccurrenceOnOrAfter, occurrencesUpTo, RECURRING_FREQUENCIES } from './recurring.model.js';
import type { RecurringFrequency, RecurringTemplateModel, RecurringTemplatePatch } from './recurring.model.js';
import { MAX_CONTENT_LENGTH, MAX_QUANTITY, REPORT_KINDS, isIsoDate, todayVietnam } from './tasking.model.js';
import type { AssignmentSource, PeriodMode, ReportKind } from './tasking.model.js';
import { AssignmentRepository, OrgDirectory, RecurringTemplateRepository } from './tasking.ports.js';
import { TaskingService } from './tasking.service.js';
import type { Actor } from './tasking.service.js';

export interface CreateTemplateInput {
  taskId: string;
  source?: AssignmentSource;
  catalogItemCode?: string;
  title?: string;
  difficulty?: number;
  plannedQuantity: number;
  frequency: RecurringFrequency;
  startDate: string;
  endDate?: string | null;
  /** Hạn = ngày lặp + số ngày này (0 đến 366). */
  dueAfterDays: number;
  periodMode?: PeriodMode;
  reportKinds?: ReportKind[];
  note?: string | null;
  approverPersonId?: string | null;
}

export type UpdateTemplateInput = Partial<Pick<CreateTemplateInput, 'plannedQuantity' | 'dueAfterDays' | 'note' | 'approverPersonId' | 'title'>> & { endDate?: string | null };

export interface TemplateView extends RecurringTemplateModel {
  /** Số việc đã sinh. */
  generatedCount: number;
  /** Lần lặp kế tiếp kể từ ngày mai (null nếu mẫu đã ngừng hoặc đã quá ngày kết thúc). */
  nextOccurrence: string | null;
}

export interface RunResult {
  templates: number;
  created: number;
  errors: { templateId: string; message: string }[];
}

const isUniqueViolation = (e: unknown): boolean =>
  (e as { driverError?: { code?: string } })?.driverError?.code === '23505' || (e instanceof Error && e.message.includes('UQ_work_assignment_recurring'));

/**
 * Việc lặp định kỳ (ADR-046): người giao việc tạo mẫu cho cấp dưới trực tiếp; đến ngày đầu mỗi chu kỳ (thứ Hai, ngày 1 hằng
 * tháng, đầu quý, 1/1) hệ thống giao một việc theo mẫu. Chạy lại bao nhiêu lần cũng không sinh trùng, và tự chạy bù các lần lặp
 * đã qua khi hệ thống tắt (sinh từ ngày bắt đầu của mẫu đến hôm nay).
 */
@Injectable()
export class RecurringService {
  private readonly logger = new Logger(RecurringService.name);

  constructor(
    private readonly templates: RecurringTemplateRepository,
    private readonly assignments: AssignmentRepository,
    private readonly org: OrgDirectory,
    private readonly tasking: TaskingService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async create(actor: Actor, input: CreateTemplateInput): Promise<TemplateView> {
    const task = await this.tasking.requireWorkTask(input.taskId);
    await this.tasking.assertAssigner(actor, task.assigneePersonId);
    if (!RECURRING_FREQUENCIES.includes(input.frequency)) throw new BadRequestException('Tần suất là WEEKLY, MONTHLY, QUARTERLY hoặc YEARLY');
    if (!Number.isInteger(input.plannedQuantity) || input.plannedQuantity < 1 || input.plannedQuantity > MAX_QUANTITY) {
      throw new BadRequestException(`Số lượng phải là số nguyên từ 1 đến ${MAX_QUANTITY}`);
    }
    if (!isIsoDate(input.startDate)) throw new BadRequestException('Ngày bắt đầu có dạng YYYY-MM-DD');
    if (input.endDate != null && (!isIsoDate(input.endDate) || input.endDate < input.startDate)) throw new BadRequestException('Ngày kết thúc phải có dạng YYYY-MM-DD và không trước ngày bắt đầu');
    assertDueAfter(input.dueAfterDays);
    if (input.note && input.note.length > MAX_CONTENT_LENGTH) throw new BadRequestException(`Nội dung tối đa ${MAX_CONTENT_LENGTH} ký tự`);

    const mode: PeriodMode = input.periodMode ?? 'AUTO';
    if (mode !== 'AUTO' && mode !== 'MANUAL') throw new BadRequestException('Chế độ tính kỳ là AUTO hoặc MANUAL');
    const kinds = mode === 'AUTO' ? [...REPORT_KINDS] : [...new Set(input.reportKinds ?? [])];
    if (kinds.length === 0 || kinds.some((k) => !REPORT_KINDS.includes(k))) throw new BadRequestException('Chế độ MANUAL cần chọn loại báo cáo MONTH, QUARTER hoặc YEAR');

    const picked = await this.tasking.resolveItem(task.assigneePersonId, input);
    const approverPersonId = await this.tasking.checkApprover(task.assigneePersonId, input.approverPersonId);
    const created = await this.templates.create({
      assigneePersonId: task.assigneePersonId,
      taskId: task.id,
      source: picked.source,
      catalogItemCode: picked.code,
      title: picked.title,
      plannedQuantity: input.plannedQuantity,
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      dueAfterDays: input.dueAfterDays,
      periodMode: mode,
      reportKinds: kinds,
      note: input.note?.trim() || null,
      approverPersonId,
      createdBy: actor.id,
    });
    await this.audit.record({
      action: 'tasking.recurring.create',
      outcome: 'SUCCESS',
      targetType: 'recurring_template',
      targetId: created.id,
      details: {
        assigneePersonId: created.assigneePersonId,
        code: created.catalogItemCode,
        source: created.source,
        ...(created.title ? { title: created.title } : {}),
        frequency: created.frequency,
        startDate: created.startDate,
        endDate: created.endDate,
        plannedQuantity: created.plannedQuantity,
        dueAfterDays: created.dueAfterDays,
      },
    });
    return this.view(created);
  }

  /** Mẫu mà người dùng quản lý được: do mình tạo, hoặc của cấp dưới trực tiếp; người có quyền xem toàn bộ thấy hết; người nhận thấy mẫu của mình. */
  async list(actor: Actor, canReadAll: boolean): Promise<TemplateView[]> {
    const all = await this.templates.findAll();
    const direct = actor.personId ? new Set(await this.org.subordinateHolders(actor.personId, { direct: true })) : new Set<string>();
    const visible = all.filter((t) => canReadAll || t.createdBy === actor.id || direct.has(t.assigneePersonId) || t.assigneePersonId === actor.personId);
    return Promise.all(visible.map((t) => this.view(t)));
  }

  async update(actor: Actor, id: string, input: UpdateTemplateInput): Promise<TemplateView> {
    const template = await this.manageable(actor, id);
    const patch: RecurringTemplatePatch = {};
    if (input.plannedQuantity !== undefined) {
      if (!Number.isInteger(input.plannedQuantity) || input.plannedQuantity < 1 || input.plannedQuantity > MAX_QUANTITY) {
        throw new BadRequestException(`Số lượng phải là số nguyên từ 1 đến ${MAX_QUANTITY}`);
      }
      patch.plannedQuantity = input.plannedQuantity;
    }
    if (input.dueAfterDays !== undefined) {
      assertDueAfter(input.dueAfterDays);
      patch.dueAfterDays = input.dueAfterDays;
    }
    if (input.endDate !== undefined) {
      if (input.endDate !== null && (!isIsoDate(input.endDate) || input.endDate < template.startDate)) throw new BadRequestException('Ngày kết thúc phải có dạng YYYY-MM-DD và không trước ngày bắt đầu');
      patch.endDate = input.endDate;
    }
    if (input.note !== undefined) {
      if (input.note && input.note.length > MAX_CONTENT_LENGTH) throw new BadRequestException(`Nội dung tối đa ${MAX_CONTENT_LENGTH} ký tự`);
      patch.note = input.note?.trim() || null;
    }
    if (input.approverPersonId !== undefined) patch.approverPersonId = await this.tasking.checkApprover(template.assigneePersonId, input.approverPersonId);
    if (input.title !== undefined) {
      if (template.source !== 'AD_HOC') throw new BadRequestException('Chỉ việc đột xuất mới có tên riêng');
      const title = input.title.trim().replace(/\s+/g, ' ');
      if (title.length < 3 || title.length > 200) throw new BadRequestException('Tên việc đột xuất dài từ 3 đến 200 ký tự');
      patch.title = title;
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException('Không có gì để sửa');
    const updated = await this.templates.update(id, patch);
    await this.audit.record({
      action: 'tasking.recurring.update',
      outcome: 'SUCCESS',
      targetType: 'recurring_template',
      targetId: id,
      details: { changed: Object.keys(patch), before: pick(template, patch), after: pick(updated, patch), note: 'Chỉ áp dụng cho các lần lặp sinh sau này' },
    });
    return this.view(updated);
  }

  /** Ngừng mẫu: không sinh thêm; các việc đã sinh giữ nguyên. */
  async deactivate(actor: Actor, id: string): Promise<TemplateView> {
    const template = await this.manageable(actor, id);
    if (template.status === 'INACTIVE') throw new ConflictException('Mẫu đã ngừng');
    const updated = await this.templates.update(id, { status: 'INACTIVE', inactiveAt: this.clock.now() });
    await this.audit.record({ action: 'tasking.recurring.deactivate', outcome: 'SUCCESS', targetType: 'recurring_template', targetId: id, details: { code: template.catalogItemCode } });
    return this.view(updated);
  }

  /** Kích hoạt lại: không sinh bù các lần lặp trong thời gian ngừng, nên ngày bắt đầu dời đến hôm nay (nếu muộn hơn). */
  async reactivate(actor: Actor, id: string): Promise<TemplateView> {
    const template = await this.manageable(actor, id);
    if (template.status === 'ACTIVE') throw new ConflictException('Mẫu đang hoạt động');
    const today = todayVietnam(this.clock.now());
    const startDate = template.startDate > today ? template.startDate : today;
    if (template.endDate !== null && template.endDate < startDate) throw new ConflictException('Mẫu đã quá ngày kết thúc, hãy kéo dài ngày kết thúc trước');
    const updated = await this.templates.update(id, { status: 'ACTIVE', inactiveAt: null, startDate });
    await this.audit.record({ action: 'tasking.recurring.reactivate', outcome: 'SUCCESS', targetType: 'recurring_template', targetId: id, details: { startDate } });
    return this.view(updated);
  }

  /** Người dùng bấm "Sinh ngay": chỉ chạy các mẫu mình quản lý (hoặc tất cả khi có quyền xem toàn bộ). */
  async runNow(actor: Actor, canReadAll: boolean): Promise<RunResult> {
    const mine = new Set((await this.list(actor, canReadAll)).filter((t) => canReadAll || t.createdBy === actor.id || t.assigneePersonId !== actor.personId).map((t) => t.id));
    const result = await this.run((t) => mine.has(t.id));
    await this.audit.record({
      action: 'tasking.recurring.run',
      outcome: 'SUCCESS',
      details: { manual: true, templates: result.templates, created: result.created, errors: result.errors.length },
    });
    return result;
  }

  /**
   * Sinh các việc đến hạn cho mọi mẫu đang hoạt động (hoặc những mẫu thỏa `filter`). Mỗi mẫu độc lập: lỗi ở mẫu này (người nhận đã
   * nghỉ, công việc không còn trong danh mục...) được ghi vào `last_error` của mẫu và không chặn các mẫu khác.
   */
  async run(filter: (t: RecurringTemplateModel) => boolean = () => true): Promise<RunResult> {
    const now = this.clock.now();
    const today = todayVietnam(now);
    const result: RunResult = { templates: 0, created: 0, errors: [] };
    for (const template of (await this.templates.findActive()).filter(filter)) {
      result.templates += 1;
      const existing = await this.assignments.findRecurringKeys(template.id);
      const missing = occurrencesUpTo(template, today).filter((o) => !existing.has(o));
      let error: string | null = null;
      for (const occurrence of missing) {
        try {
          await this.tasking.spawn(template, occurrence, addDaysIso(occurrence, template.dueAfterDays));
          result.created += 1;
        } catch (e) {
          if (isUniqueViolation(e)) continue; // một tiến trình khác vừa sinh: coi như đã có
          error = e instanceof Error ? e.message : String(e);
          result.errors.push({ templateId: template.id, message: error });
          this.logger.warn(`Mẫu ${template.id}, lần lặp ${occurrence}: ${error}`);
          break; // dừng mẫu này, các lần sau thử lại ở lượt chạy kế
        }
      }
      await this.templates.update(template.id, { lastRunAt: now, lastError: error });
    }
    return result;
  }

  private async manageable(actor: Actor, id: string): Promise<RecurringTemplateModel> {
    const template = await this.templates.findById(id);
    if (!template) throw new NotFoundException(`Không tìm thấy mẫu việc lặp: ${id}`);
    if (template.createdBy !== actor.id) await this.tasking.assertAssigner(actor, template.assigneePersonId).catch(() => {
      throw new ForbiddenException('Chỉ người tạo mẫu hoặc cấp trên trực tiếp của người nhận mới quản lý được mẫu này');
    });
    return template;
  }

  private async view(t: RecurringTemplateModel): Promise<TemplateView> {
    const tomorrow = addDaysIso(todayVietnam(this.clock.now()), 1);
    const from = t.startDate > tomorrow ? t.startDate : tomorrow;
    const next = firstOccurrenceOnOrAfter(t.frequency, from);
    return {
      ...t,
      generatedCount: (await this.assignments.findRecurringKeys(t.id)).size,
      nextOccurrence: t.status === 'ACTIVE' && (t.endDate === null || next <= t.endDate) ? next : null,
    };
  }
}

function assertDueAfter(days: number): void {
  if (!Number.isInteger(days) || days < 0 || days > 366) throw new BadRequestException('Hạn hoàn thành tính từ ngày lặp là số nguyên từ 0 đến 366 ngày');
}

function pick(t: RecurringTemplateModel, patch: RecurringTemplatePatch): Record<string, unknown> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, t[k as keyof RecurringTemplateModel]]));
}
