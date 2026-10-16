import { adHocCoefficient, adHocCode, adHocLabel, adHocLevelOf, isAdHocLevel } from '../../../common/ad-hoc.js';
import { snapshot } from '../../../common/audit-snapshot.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { isInScope } from '../../../common/scope.js';
import { Notifier } from '../../../common/notifier.js';
import { buildExportFile, MAX_EXPORT_ROWS } from '../../../common/table-export.js';
import type { ExportedTable, TableFormat } from '../../../common/table-export.js';
import { buildTaskExport, taskStatistics } from './task-report.js';
import type { TaskStatistics } from './task-report.js';
import type { ParsedOkr } from '../../organization/index.js';
import { AuditService } from '../../security/index.js';
import { ASSIGNMENT_STATES, belongsToPeriod, isIsoDate, MAX_CONSULTANTS, MAX_CONTENT_LENGTH, MAX_QUANTITY, REPORT_KINDS, stateOf, summarize, todayVietnam } from './tasking.model.js';
import type {
  AssignedWork,
  AssignmentModel,
  AssignmentPatch,
  AssignmentSource,
  AssignmentState,
  PeriodMode,
  PeriodRange,
  ProgressModel,
  ProgressSummary,
  ReportKind,
  WorkTaskModel,
} from './tasking.model.js';
import type { RecurringTemplateModel } from './recurring.model.js';
import { AssignmentRepository, CatalogDirectory, ConsultantRepository, OrgDirectory, ProgressRepository, WorkTaskRepository } from './tasking.ports.js';
import type { CatalogItemInfo } from './tasking.ports.js';

/** Người thao tác: tài khoản đang đăng nhập và cán bộ gắn với tài khoản đó (có thể chưa gắn). */
export interface Actor {
  id: string;
  username: string;
  personId: string | null;
}

export interface AssignmentView {
  assignment: AssignmentModel;
  task: { id: string; title: string };
  itemName: string;
  coefficient: number | null;
  progress: ProgressModel[];
  summary: ProgressSummary;
  /** Người xác nhận kết quả: người duyệt (cc) nếu có, không thì cấp trên trực tiếp hiện tại (null nếu vị trí đang trống). */
  confirmerPersonId: string | null;
  /** Người duyệt do người giao chọn; null nếu dùng cấp trên trực tiếp (ADR-024). */
  approverPersonId: string | null;
  consultantPersonIds: string[];
  state: AssignmentState;
  /** Mức độ khó (1 đến 4) của việc đột xuất; null với việc từ danh mục. */
  adHocLevel: number | null;
}

export interface AssignInput {
  /** Nhiệm vụ chứa công việc; cán bộ nhận việc là người của nhiệm vụ đó. */
  taskId: string;
  /** CATALOG (mặc định): việc trong danh mục. AD_HOC: việc đột xuất, cần `title` và `difficulty` (ADR-046). */
  source?: AssignmentSource;
  /** Mã công việc trong danh mục; bắt buộc với CATALOG, bỏ qua với AD_HOC. */
  catalogItemCode?: string;
  /** Tên việc đột xuất, 3 đến 200 ký tự. */
  title?: string;
  /** Mức độ khó của việc đột xuất, 1 đến 4; quyết định hệ số quy đổi. */
  difficulty?: number;
  plannedQuantity: number;
  dueDate: string;
  periodMode: PeriodMode;
  reportKinds?: ReportKind[];
  /** Nội dung việc (tối đa 4000 ký tự). */
  note?: string | null;
  /** Người duyệt (cc), một cấp trên của người nhận. Bỏ trống thì là cấp trên trực tiếp. */
  approverPersonId?: string | null;
  /** Người tham vấn, không bắt buộc, tối đa 10. */
  consultantPersonIds?: string[];
  /** Mã kết quả then chốt (KR1...) trong OKR của người nhận mà việc này góp phần đạt (ADR-034). */
  keyResult?: string | null;
  /** Vị trí người nhận giữ mà việc này thuộc về. Bắt buộc khi người nhận kiêm nhiệm nhiều vị trí (ADR-047). */
  positionId?: string | null;
}

export type ListScope = 'mine' | 'team' | 'all';
export const WORK_KINDS = ['CATALOG', 'AD_HOC', 'RECURRING'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
/** Phạm vi theo dõi việc: ngoài ba phạm vi cũ còn được tham vấn, tôi là người duyệt, tôi đã giao (ADR-024). */
export type SearchScope = ListScope | 'consulted' | 'approving' | 'assigned';

export interface SearchQuery {
  scope: SearchScope;
  q?: string;
  states?: AssignmentState[];
  assigneePersonId?: string;
  /** Loại việc: CATALOG (giao từ danh mục), AD_HOC (đột xuất), RECURRING (do mẫu lặp định kỳ sinh ra). */
  kind?: WorkKind;
  dueFrom?: string;
  dueTo?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: 'due' | 'dueDesc' | 'created';
  page?: number;
  pageSize?: number;
}

export interface SearchResult {
  items: AssignmentView[];
  total: number;
  page: number;
  pageSize: number;
  /** Số việc theo từng trạng thái, tính trên kết quả đã lọc trừ điều kiện trạng thái. */
  stateCounts: Record<AssignmentState, number>;
}

/** Bỏ dấu, viết thường để tìm "tham dinh" ra "Thẩm định". */
export const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** Nhiệm vụ tự tạo chứa các việc đột xuất của một cán bộ khi không nêu nhiệm vụ nào. */
export const AD_HOC_TASK_TITLE = 'Việc đột xuất';

const assertDifficulty = (value: number | undefined) => {
  if (!isAdHocLevel(value)) throw new BadRequestException('Mức độ khó của việc đột xuất là số nguyên từ 1 đến 4');
  return value;
};

const cleanAdHocTitle = (title: string | undefined): string => {
  const clean = (title ?? '').trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 200) throw new BadRequestException('Tên việc đột xuất dài từ 3 đến 200 ký tự');
  return clean;
};

const assertContent = (note: string | null | undefined): void => {
  if (note && note.length > MAX_CONTENT_LENGTH) throw new BadRequestException(`Nội dung tối đa ${MAX_CONTENT_LENGTH} ký tự`);
};

const assertQuantity = (value: number, label: string): void => {
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) {
    throw new BadRequestException(`${label} phải là số nguyên từ 1 đến ${MAX_QUANTITY}`);
  }
};

/**
 * Giao việc, báo cáo hoàn thành, cấp trên xác nhận (ADR-016). Quyền theo vai trò kiểm tra ở lớp trình bày;
 * ở đây kiểm tra quan hệ cấp trên - cấp dưới theo sơ đồ tổ chức và trạng thái của việc.
 */
@Injectable()
export class TaskingService {
  constructor(
    private readonly assignments: AssignmentRepository,
    private readonly progress: ProgressRepository,
    private readonly workTasks: WorkTaskRepository,
    private readonly consultants: ConsultantRepository,
    private readonly org: OrgDirectory,
    private readonly catalog: CatalogDirectory,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  /** Tạo nhiệm vụ cho cấp dưới trực tiếp (ADR-018). Tên không trùng trong cùng một cán bộ. */
  async createTask(actor: Actor, input: { assigneePersonId: string; title: string; description?: string | null }): Promise<WorkTaskModel> {
    this.assertActor(actor, await this.confirmerOf(input.assigneePersonId), 'giao nhiệm vụ cho');
    const title = input.title.trim().replace(/\s+/g, ' ');
    if (title.length < 3 || title.length > 200) throw new BadRequestException('Tên nhiệm vụ dài từ 3 đến 200 ký tự');
    if (await this.workTasks.findByAssigneeAndTitle(input.assigneePersonId, title)) {
      throw new ConflictException('Cán bộ này đã có nhiệm vụ cùng tên');
    }
    const created = await this.workTasks.create({
      assigneePersonId: input.assigneePersonId,
      title,
      description: input.description?.trim() || null,
      createdByAccountId: actor.id,
    });
    await this.audit.record({
      action: 'tasking.task.create',
      outcome: 'SUCCESS',
      targetType: 'work_task',
      targetId: created.id,
      details: { assigneePersonId: created.assigneePersonId, title },
    });
    return created;
  }

  /** Danh sách nhiệm vụ theo cùng phạm vi với danh sách việc. */
  async listTasks(actor: Actor, scope: ListScope, canReadAll: boolean): Promise<WorkTaskModel[]> {
    let rows: WorkTaskModel[];
    if (scope === 'all') {
      if (!canReadAll) throw new ForbiddenException('Bạn không có quyền xem toàn bộ nhiệm vụ');
      rows = await this.workTasks.findAll();
    } else {
      if (!actor.personId) return [];
      rows =
        scope === 'mine'
          ? await this.workTasks.findByAssignees([actor.personId])
          : await this.workTasks.findByAssignees(await this.org.subordinateHolders(actor.personId, { direct: false }));
    }
    return rows.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
  }

  /**
   * Giao một việc cho cấp dưới trực tiếp, thuộc một nhiệm vụ: việc trong danh mục, hoặc việc đột xuất (`source: 'AD_HOC'`,
   * ADR-046) không có trong danh mục, do người giao chọn mức độ khó.
   */
  async assign(actor: Actor, input: AssignInput): Promise<AssignmentView> {
    const task = await this.requireTask(input.taskId);
    const assigneePersonId = task.assigneePersonId;
    const positionId = await this.resolveAssigneePosition(assigneePersonId, input.positionId, true);
    const confirmer = await this.confirmerOf(assigneePersonId, positionId);
    this.assertActor(actor, confirmer, 'giao việc cho');

    assertQuantity(input.plannedQuantity, 'Số lượng giao');
    if (!isIsoDate(input.dueDate)) throw new BadRequestException('Hạn hoàn thành phải có dạng YYYY-MM-DD');
    const kinds = this.resolveKinds(input.periodMode, input.reportKinds);
    assertContent(input.note);
    const people = await this.checkParticipants(assigneePersonId, input.approverPersonId, input.consultantPersonIds, positionId);
    const okrKeyResult = await this.resolveKeyResult(assigneePersonId, input.keyResult);

    const current = await this.catalog.currentApproved();
    if (!current) throw new ConflictException('Chưa có danh mục sản phẩm công việc nào được phê duyệt');
    const picked = await this.pickItem(assigneePersonId, current, input, positionId);

    const created = await this.assignments.create({
      taskId: task.id,
      assigneePersonId,
      positionId,
      assignerAccountId: actor.id,
      catalogItemCode: picked.code,
      catalogVersionId: current.versionId,
      plannedQuantity: input.plannedQuantity,
      dueDate: input.dueDate,
      periodMode: input.periodMode,
      reportKinds: kinds,
      note: input.note?.trim() || null,
      approverPersonId: people.approverId,
      okrKeyResult,
      source: picked.source,
      title: picked.title,
    });
    if (people.consultantIds.length > 0) await this.consultants.replace(created.id, people.consultantIds);
    await this.audit.record({
      action: 'tasking.assignment.create',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      targetId: created.id,
      details: {
        taskId: task.id,
        assigneePersonId: created.assigneePersonId,
        positionId,
        code: created.catalogItemCode,
        source: created.source,
        ...(created.title ? { title: created.title } : {}),
        plannedQuantity: created.plannedQuantity,
        dueDate: created.dueDate,
        periodMode: created.periodMode,
        reportKinds: created.reportKinds,
        approverPersonId: people.approverId,
        consultants: people.consultantIds.length,
        okrKeyResult,
      },
    });
    const link = `/tasks?open=${created.id}`;
    const others = (ids: readonly (string | null)[]) => ids.filter((p) => p !== actor.personId && p !== assigneePersonId);
    await this.notifier.notify([assigneePersonId], { type: 'TASK_ASSIGNED', title: `Bạn được giao việc${created.source === 'AD_HOC' ? ' đột xuất' : ''}: ${task.title}`, link });
    await this.notifier.notify(others([people.approverId]), { type: 'TASK_ROLE', title: `Bạn được chỉ định duyệt kết quả việc: ${task.title}`, link });
    await this.notifier.notify(others(people.consultantIds), { type: 'TASK_ROLE', title: `Bạn được mời tham vấn việc: ${task.title}`, link });
    return this.view(created, [], people.approverId ?? confirmer, new Map(current.items), task, people.consultantIds, todayVietnam(this.clock.now()));
  }

  /**
   * Chọn công việc của một lần giao: từ danh mục (phải có, có điểm chấm, đúng phạm vi áp dụng của người nhận) hoặc việc đột xuất
   * (mã ảo theo mức độ khó). Dùng chung cho giao tay và sinh việc lặp.
   */
  private async pickItem(
    assigneePersonId: string,
    current: { versionId: string; items: Map<string, CatalogItemInfo> },
    input: { source?: AssignmentSource; catalogItemCode?: string; title?: string; difficulty?: number },
    positionId?: string | null,
  ): Promise<{ code: string; source: AssignmentSource; title: string | null }> {
    if (input.source === 'AD_HOC') {
      return { code: adHocCode(assertDifficulty(input.difficulty)), source: 'AD_HOC', title: cleanAdHocTitle(input.title) };
    }
    if (input.source !== undefined && input.source !== 'CATALOG') throw new BadRequestException('Nguồn việc là CATALOG hoặc AD_HOC');
    if (!input.catalogItemCode) throw new BadRequestException('Cần chọn công việc trong danh mục');
    const item = current.items.get(input.catalogItemCode);
    if (!item) throw new NotFoundException(`Công việc ${input.catalogItemCode} không có trong danh mục đang hiệu lực`);
    if (item.coefficient === null || item.coefficient <= 0) {
      throw new ConflictException(`Công việc ${input.catalogItemCode} chưa có điểm chấm nên chưa giao được`);
    }
    const scope = { unitIds: item.unitIds ?? [], positionIds: item.positionIds ?? [] };
    if (!isInScope(scope, await this.org.placementOf(assigneePersonId, positionId))) {
      throw new ConflictException(`Công việc ${input.catalogItemCode} không thuộc phạm vi áp dụng của đơn vị, vị trí của người nhận`);
    }
    return { code: input.catalogItemCode, source: 'CATALOG', title: null };
  }

  /**
   * Cán bộ đề xuất một việc đột xuất cho chính mình (ADR-046). Việc ở trạng thái PROPOSED, chưa tính vào hồ sơ kỳ cho đến khi
   * cấp trên trực tiếp duyệt và chọn mức độ khó. Gắn vào nhiệm vụ nêu ra (phải là của chính mình) hoặc nhiệm vụ "Việc đột xuất".
   */
  async propose(
    actor: Actor,
    input: { taskId?: string; title: string; plannedQuantity: number; dueDate: string; difficulty?: number; note?: string | null; positionId?: string | null },
  ): Promise<AssignmentView> {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác được');
    const positionId = await this.resolveAssigneePosition(actor.personId, input.positionId, false);
    const confirmer = await this.confirmerOf(actor.personId, positionId);
    if (confirmer === null) throw new ConflictException('Chưa có người giữ vị trí cấp trên để duyệt đề xuất');
    assertQuantity(input.plannedQuantity, 'Số lượng');
    if (!isIsoDate(input.dueDate)) throw new BadRequestException('Hạn hoàn thành phải có dạng YYYY-MM-DD');
    assertContent(input.note);
    const title = cleanAdHocTitle(input.title);
    const level = input.difficulty === undefined ? 2 : assertDifficulty(input.difficulty);

    let task: WorkTaskModel;
    if (input.taskId) {
      task = await this.requireTask(input.taskId);
      if (task.assigneePersonId !== actor.personId) throw new ForbiddenException('Chỉ đề xuất được vào nhiệm vụ của chính mình');
    } else {
      task = await this.adHocTaskOf(actor.personId, actor.id);
    }
    const current = await this.catalog.currentApproved();
    if (!current) throw new ConflictException('Chưa có danh mục sản phẩm công việc nào được phê duyệt');

    const created = await this.assignments.create({
      taskId: task.id,
      assigneePersonId: actor.personId,
      positionId,
      assignerAccountId: null,
      catalogItemCode: adHocCode(level),
      catalogVersionId: current.versionId,
      plannedQuantity: input.plannedQuantity,
      dueDate: input.dueDate,
      periodMode: 'AUTO',
      reportKinds: [...REPORT_KINDS],
      note: input.note?.trim() || null,
      source: 'AD_HOC',
      title,
      status: 'PROPOSED',
    });
    await this.audit.record({
      action: 'tasking.proposal.create',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      targetId: created.id,
      details: { assigneePersonId: actor.personId, title, plannedQuantity: created.plannedQuantity, dueDate: created.dueDate, suggestedLevel: level },
    });
    await this.notifier.notify([confirmer], { type: 'TASK_PROPOSED', title: `Đề xuất việc đột xuất chờ bạn duyệt: ${title}`, link: `/tasks?open=${created.id}` });
    return (await this.views([created]))[0];
  }

  /**
   * Cấp trên trực tiếp duyệt đề xuất: chọn mức độ khó (hệ số quy đổi), có thể chỉnh số lượng và hạn; việc chuyển sang OPEN và người duyệt
   * trở thành người giao.
   */
  async approveProposal(
    actor: Actor,
    id: string,
    input: { difficulty: number; plannedQuantity?: number; dueDate?: string; note?: string | null },
  ): Promise<AssignmentView> {
    const assignment = await this.requireProposal(id);
    this.assertActor(actor, await this.confirmerOf(assignment.assigneePersonId, assignment.positionId), 'duyệt đề xuất của');
    const level = assertDifficulty(input.difficulty);
    const patch: AssignmentPatch = { catalogItemCode: adHocCode(level), assignerAccountId: actor.id };
    if (input.plannedQuantity !== undefined) {
      assertQuantity(input.plannedQuantity, 'Số lượng');
      patch.plannedQuantity = input.plannedQuantity;
    }
    if (input.dueDate !== undefined) {
      if (!isIsoDate(input.dueDate)) throw new BadRequestException('Hạn hoàn thành phải có dạng YYYY-MM-DD');
      patch.dueDate = input.dueDate;
    }
    if (input.note !== undefined) {
      assertContent(input.note);
      patch.note = input.note?.trim() || null;
    }
    await this.assignments.update(id, patch);
    const updated = await this.assignments.setStatus(id, 'OPEN');
    await this.audit.record({
      action: 'tasking.proposal.approve',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      targetId: id,
      details: {
        assigneePersonId: assignment.assigneePersonId,
        title: assignment.title,
        level,
        before: snapshot(assignment, ['plannedQuantity', 'dueDate', 'catalogItemCode']),
        after: snapshot(updated, ['plannedQuantity', 'dueDate', 'catalogItemCode']),
      },
    });
    await this.notifier.notify([assignment.assigneePersonId], {
      type: 'TASK_PROPOSAL_DECIDED',
      title: `Đề xuất được duyệt (mức ${level}): ${assignment.title ?? ''}`,
      link: `/tasks?open=${id}`,
    });
    return (await this.views([updated]))[0];
  }

  /** Cấp trên trực tiếp từ chối đề xuất, nêu lý do; việc chuyển sang đã hủy. */
  async rejectProposal(actor: Actor, id: string, reason: string): Promise<AssignmentView> {
    const assignment = await this.requireProposal(id);
    this.assertActor(actor, await this.confirmerOf(assignment.assigneePersonId, assignment.positionId), 'duyệt đề xuất của');
    const note = reason?.trim() ?? '';
    if (note.length < 3) throw new BadRequestException('Cần nêu lý do khi từ chối');
    const updated = await this.assignments.setStatus(id, 'CANCELLED');
    await this.audit.record({
      action: 'tasking.proposal.reject',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      targetId: id,
      details: { assigneePersonId: assignment.assigneePersonId, title: assignment.title, reason: note },
    });
    await this.notifier.notify([assignment.assigneePersonId], {
      type: 'TASK_PROPOSAL_DECIDED',
      title: `Đề xuất bị từ chối: ${assignment.title ?? ''} (${note})`.slice(0, 190),
      link: `/tasks?open=${id}`,
    });
    return (await this.views([updated]))[0];
  }

  // ------------------------------------------------------------- dùng cho việc lặp định kỳ (RecurringService, ADR-046)

  /** Người thao tác phải là cấp trên trực tiếp của người nhận (cùng quy tắc giao việc). */
  async assertAssigner(actor: Actor, assigneePersonId: string): Promise<void> {
    this.assertActor(actor, await this.confirmerOf(assigneePersonId), 'giao việc cho');
  }

  requireWorkTask(id: string): Promise<WorkTaskModel> {
    return this.requireTask(id);
  }

  /** Người duyệt (cc) hợp lệ của người nhận; null nghĩa là cấp trên trực tiếp. */
  async checkApprover(assigneePersonId: string, approverPersonId: string | null | undefined): Promise<string | null> {
    return (await this.checkParticipants(assigneePersonId, approverPersonId, [])).approverId;
  }

  /** Kiểm tra công việc của một mẫu lặp theo danh mục đang hiệu lực (hoặc việc đột xuất) và trả về mã, nguồn, tên. */
  async resolveItem(
    assigneePersonId: string,
    input: { source?: AssignmentSource; catalogItemCode?: string; title?: string; difficulty?: number },
  ): Promise<{ code: string; source: AssignmentSource; title: string | null }> {
    const current = await this.catalog.currentApproved();
    if (!current) throw new ConflictException('Chưa có danh mục sản phẩm công việc nào được phê duyệt');
    return this.pickItem(assigneePersonId, current, input);
  }

  /**
   * Giao một việc theo mẫu lặp cho lần lặp `occurrence` (YYYY-MM-DD). Không có người thao tác nên không kiểm quyền (đã kiểm khi
   * tạo mẫu); kiểm lại người nhận còn được quản lý, công việc còn trong danh mục và đúng phạm vi. Sinh trùng bị CSDL chặn
   * (cặp mẫu, ngày lặp là duy nhất).
   */
  async spawn(template: RecurringTemplateModel, occurrence: string, dueDate: string): Promise<AssignmentModel> {
    const assigneePersonId = template.assigneePersonId;
    if (!(await this.org.activePersonIds([assigneePersonId])).has(assigneePersonId)) throw new ConflictException('Người nhận việc đã ngừng quản lý');
    const task = await this.requireTask(template.taskId);
    const current = await this.catalog.currentApproved();
    if (!current) throw new ConflictException('Chưa có danh mục sản phẩm công việc nào được phê duyệt');
    const positionId = await this.resolveAssigneePosition(assigneePersonId, null, false);
    const picked = await this.pickItem(assigneePersonId, current, {
      source: template.source,
      catalogItemCode: template.catalogItemCode,
      title: template.title ?? undefined,
      difficulty: adHocLevelOf(template.catalogItemCode) ?? undefined,
    }, positionId);
    const approverId = template.approverPersonId && (await this.org.superiorHolders(assigneePersonId, positionId)).includes(template.approverPersonId) ? template.approverPersonId : null;

    const created = await this.assignments.create({
      taskId: task.id,
      assigneePersonId,
      positionId,
      assignerAccountId: template.createdBy,
      catalogItemCode: picked.code,
      catalogVersionId: current.versionId,
      plannedQuantity: template.plannedQuantity,
      dueDate,
      periodMode: template.periodMode,
      reportKinds: template.reportKinds,
      note: template.note,
      approverPersonId: approverId,
      source: picked.source,
      title: picked.title,
      recurringTemplateId: template.id,
      recurringKey: occurrence,
    });
    await this.audit.record({
      action: 'tasking.assignment.create',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      targetId: created.id,
      actor: null,
      details: {
        taskId: task.id,
        assigneePersonId,
        code: created.catalogItemCode,
        source: created.source,
        ...(created.title ? { title: created.title } : {}),
        plannedQuantity: created.plannedQuantity,
        dueDate,
        recurringTemplateId: template.id,
        occurrence,
        generated: true,
      },
    });
    await this.notifier.notify([assigneePersonId], { type: 'TASK_ASSIGNED', title: `Việc định kỳ mới: ${picked.title ?? task.title}`, link: `/tasks?open=${created.id}` });
    await this.notifier.notify([approverId].filter((p) => p !== assigneePersonId), { type: 'TASK_ROLE', title: `Bạn được chỉ định duyệt kết quả việc: ${task.title}`, link: `/tasks?open=${created.id}` });
    return created;
  }

  private async requireProposal(id: string): Promise<AssignmentModel> {
    const assignment = await this.require(id);
    if (assignment.status !== 'PROPOSED') throw new ConflictException('Việc này không phải đề xuất đang chờ duyệt');
    return assignment;
  }

  /** Nhiệm vụ "Việc đột xuất" của cán bộ: dùng lại nếu có, không thì tạo (do chính người thao tác đứng tên). */
  private async adHocTaskOf(personId: string, accountId: string): Promise<WorkTaskModel> {
    const found = await this.workTasks.findByAssigneeAndTitle(personId, AD_HOC_TASK_TITLE);
    if (found) return found;
    const created = await this.workTasks.create({ assigneePersonId: personId, title: AD_HOC_TASK_TITLE, description: 'Việc phát sinh ngoài kế hoạch (ADR-046)', createdByAccountId: accountId });
    await this.audit.record({
      action: 'tasking.task.create',
      outcome: 'SUCCESS',
      targetType: 'work_task',
      targetId: created.id,
      details: { assigneePersonId: personId, title: AD_HOC_TASK_TITLE, auto: true },
    });
    return created;
  }

  /** Danh sách việc: của chính mình, của cấp dưới (mọi cấp), hoặc toàn bộ (cần quyền xem toàn bộ). */
  async list(actor: Actor, scope: ListScope, canReadAll: boolean): Promise<AssignmentView[]> {
    let rows: AssignmentModel[];
    if (scope === 'all') {
      if (!canReadAll) throw new ForbiddenException('Bạn không có quyền xem toàn bộ việc được giao');
      rows = await this.assignments.findAll();
    } else {
      if (!actor.personId) return [];
      rows =
        scope === 'mine'
          ? await this.assignments.findByAssignees([actor.personId])
          : await this.assignments.findByAssignees(await this.org.subordinateHolders(actor.personId, { direct: false }));
    }
    return this.views(rows);
  }

  async get(actor: Actor, id: string, canReadAll: boolean): Promise<AssignmentView> {
    const assignment = await this.require(id);
    await this.assertCanView(actor, assignment, canReadAll);
    return (await this.views([assignment]))[0];
  }

  /** Cán bộ báo cáo đã hoàn thành (một phần hoặc toàn bộ); số lượng chỉ được tính sau khi cấp trên xác nhận. */
  async report(actor: Actor, assignmentId: string, input: { quantity: number; completedOn: string; evidence?: string | null }): Promise<ProgressModel> {
    const assignment = await this.require(assignmentId);
    this.assertSubject(actor, assignment);
    if (assignment.status === 'PROPOSED') throw new ConflictException('Đề xuất chưa được duyệt, chưa báo cáo được');
    if (assignment.status !== 'OPEN') throw new ConflictException('Việc đã bị hủy, không báo cáo thêm được');
    assertQuantity(input.quantity, 'Số lượng hoàn thành');
    if (!isIsoDate(input.completedOn)) throw new BadRequestException('Ngày hoàn thành phải có dạng YYYY-MM-DD');
    if (input.completedOn > todayVietnam(this.clock.now())) throw new BadRequestException('Ngày hoàn thành không được ở tương lai');

    const created = await this.progress.create({
      assignmentId,
      quantity: input.quantity,
      completedOn: input.completedOn,
      evidence: input.evidence?.trim() || null,
      reportedBy: actor.id,
    });
    await this.audit.record({
      action: 'tasking.progress.report',
      outcome: 'SUCCESS',
      targetType: 'work_progress',
      targetId: created.id,
      details: { assignmentId, code: assignment.catalogItemCode, quantity: created.quantity, completedOn: created.completedOn },
    });
    const title = (await this.requireTask(assignment.taskId)).title;
    await this.notifier.notify([await this.approverOf(assignment)], { type: 'TASK_REPORTED', title: `Báo cáo kết quả chờ bạn xác nhận: ${title}`, link: `/tasks?open=${assignmentId}` });
    return created;
  }

  /**
   * Cấp trên trực tiếp xác nhận hoặc từ chối một lần báo cáo. Từ chối cần nêu lý do và nói rõ có phải sai sót lớn về nội dung
   * hay không: chỉ sai sót lớn mới là một lần chưa đạt, bị trừ 25% điểm chất lượng (Nghị định 335/2025 Điều 14.2.b).
   */
  async decide(actor: Actor, progressId: string, input: { decision: 'CONFIRM' | 'REJECT'; note?: string | null; majorError?: boolean }): Promise<ProgressModel> {
    const progress = await this.progress.findById(progressId);
    if (!progress) throw new NotFoundException(`Không tìm thấy lần báo cáo: ${progressId}`);
    const assignment = await this.require(progress.assignmentId);
    this.assertActor(actor, await this.approverOf(assignment), 'xác nhận kết quả của');
    if (progress.status !== 'REPORTED') throw new ConflictException('Lần báo cáo này đã được xử lý');
    if (assignment.status !== 'OPEN') throw new ConflictException('Việc đã bị hủy');
    const note = input.note?.trim() || null;
    if (input.decision === 'REJECT' && (note?.length ?? 0) < 3) throw new BadRequestException('Cần nêu lý do khi từ chối');
    if (input.decision === 'REJECT' && typeof input.majorError !== 'boolean') throw new BadRequestException('Cần nói rõ có phải sai sót lớn về nội dung hay không');

    const updated = await this.progress.update(progressId, {
      status: input.decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
      decidedBy: actor.id,
      decidedAt: this.clock.now(),
      decisionNote: note,
      ...(input.decision === 'REJECT' ? { majorError: input.majorError } : {}),
    });
    await this.audit.record({
      action: input.decision === 'CONFIRM' ? 'tasking.progress.confirm' : 'tasking.progress.reject',
      outcome: 'SUCCESS',
      targetType: 'work_progress',
      targetId: progressId,
      details: { assignmentId: assignment.id, code: assignment.catalogItemCode, quantity: progress.quantity, late: progress.completedOn > assignment.dueDate, note, ...(input.decision === 'REJECT' ? { majorError: input.majorError } : {}) },
    });
    const title = (await this.requireTask(assignment.taskId)).title;
    await this.notifier.notify([assignment.assigneePersonId], {
      type: input.decision === 'CONFIRM' ? 'TASK_CONFIRMED' : 'TASK_REJECTED',
      title: input.decision === 'CONFIRM' ? `Kết quả được xác nhận: ${title}` : `Báo cáo bị từ chối, cần làm lại: ${title}`,
      link: `/tasks?open=${assignment.id}`,
    });
    return updated;
  }

  /** Hủy việc giao sai. Không hủy được nếu đã có kết quả được xác nhận. */
  async cancel(actor: Actor, id: string): Promise<AssignmentModel> {
    const assignment = await this.require(id);
    this.assertActor(actor, await this.confirmerOf(assignment.assigneePersonId, assignment.positionId), 'hủy việc của');
    if (assignment.status === 'CANCELLED') return assignment;
    const progress = await this.progress.findByAssignments([id]);
    if (progress.some((p) => p.status === 'CONFIRMED')) throw new ConflictException('Việc đã có kết quả được xác nhận nên không hủy được');

    const updated = await this.assignments.setStatus(id, 'CANCELLED');
    await this.audit.record({
      action: 'tasking.assignment.cancel',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      targetId: id,
      details: { assigneePersonId: assignment.assigneePersonId, code: assignment.catalogItemCode },
    });
    const title = (await this.requireTask(assignment.taskId)).title;
    await this.notifier.notify(await this.participantsOf(assignment, actor.personId), { type: 'TASK_CANCELLED', title: `Việc đã bị hủy: ${title}`, link: `/tasks?open=${assignment.id}` });
    return updated;
  }

  /**
   * Các việc thuộc kỳ (hạn nằm trong kỳ, loại kỳ được chọn) kèm số liệu đã xác nhận, để Văn phòng
   * điền hồ sơ kỳ (ADR-016 mục 4, 5). Chỉ đọc.
   */
  async collectForPeriod(period: PeriodRange): Promise<AssignedWork[]> {
    const rows = (await this.assignments.findOpenDueBetween(period.startDate, period.endDate)).filter((a) => belongsToPeriod(a, period));
    if (rows.length === 0) return [];
    const progress = await this.progress.findByAssignments(rows.map((r) => r.id));
    const titles = new Map((await this.workTasks.findByIds([...new Set(rows.map((r) => r.taskId))])).map((t) => [t.id, t.title]));
    return rows.map((a) => {
      const own = progress.filter((p) => p.assignmentId === a.id);
      const evidence = [...new Set(own.filter((p) => p.status === 'CONFIRMED' && p.evidence).map((p) => p.evidence!))].join(' | ');
      return {
        assignmentId: a.id,
        taskTitle: titles.get(a.taskId) ?? '',
        personId: a.assigneePersonId,
        positionId: a.positionId,
        catalogItemCode: a.catalogItemCode,
        plannedQuantity: a.plannedQuantity,
        evidence: evidence ? evidence.slice(0, 2000) : null,
        ...summarize(a, own),
      };
    });
  }

  // ------------------------------------------------------------------ nội bộ

  private resolveKinds(mode: PeriodMode, kinds: ReportKind[] | undefined): ReportKind[] {
    if (mode === 'AUTO') return [...REPORT_KINDS];
    if (mode !== 'MANUAL') throw new BadRequestException('Chế độ tính kỳ là AUTO hoặc MANUAL');
    const unique = [...new Set(kinds ?? [])];
    if (unique.length === 0) throw new BadRequestException('Chế độ MANUAL cần chọn ít nhất một loại báo cáo');
    if (unique.some((k) => !REPORT_KINDS.includes(k))) throw new BadRequestException('Loại báo cáo là MONTH, QUARTER hoặc YEAR');
    return unique;
  }

  /** Cấp trên trực tiếp: người đầu tiên giữ vị trí cấp trên (bỏ vị trí trống). */
  /**
   * OKR của vị trí cán bộ: chính họ, các cấp trên của họ, hoặc người xem toàn bộ (ADR-034).
   * Dùng để người giao chọn kết quả then chốt khi giao việc và để cán bộ xem định hướng của mình.
   */
  async okrOf(actor: Actor, personId: string, canReadAll: boolean): Promise<ParsedOkr | null> {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác được');
    const allowed = canReadAll || actor.personId === personId || (await this.org.superiorHolders(personId)).includes(actor.personId);
    if (!allowed) throw new ForbiddenException('Bạn không xem được OKR của cán bộ này');
    return this.org.okrOf(personId);
  }

  /** Đổi mã kết quả then chốt người giao chọn thành nhãn đầy đủ; mã phải có trong OKR của người nhận. */
  private async resolveKeyResult(assigneePersonId: string, code: string | null | undefined): Promise<string | null> {
    const wanted = code?.trim();
    if (!wanted) return null;
    const found = (await this.org.okrOf(assigneePersonId))?.keyResults.find((k) => k.code === wanted);
    if (!found) throw new BadRequestException(`Kết quả then chốt ${wanted} không có trong OKR của người nhận việc`);
    return `${found.code}: ${found.text}`;
  }

  private async confirmerOf(personId: string, positionId?: string | null): Promise<string | null> {
    return (await this.org.superiorHolders(personId, positionId))[0] ?? null;
  }

  /**
   * Vị trí mà một việc được giao cho. Nêu `requested`: phải là vị trí người nhận đang giữ. Không nêu: người chỉ giữ một vị trí
   * thì lấy vị trí đó; người kiêm nhiệm thì (khi `strict`, giao tay) bắt buộc chọn, còn lại (đề xuất, việc lặp) lấy vị trí chính.
   */
  private async resolveAssigneePosition(personId: string, requested: string | null | undefined, strict: boolean): Promise<string | null> {
    const held = await this.org.placementsOf(personId);
    if (requested) {
      if (!held.some((h) => h.positionId === requested)) throw new ConflictException('Người nhận việc hiện không giữ vị trí này');
      return requested;
    }
    if (held.length === 0) return null;
    if (strict && held.length > 1) throw new BadRequestException('Người nhận việc đang kiêm nhiệm nhiều vị trí: cần chọn việc này thuộc vị trí nào');
    return (held.find((h) => h.kind === 'PRIMARY') ?? held[0]).positionId;
  }

  private assertActor(actor: Actor, expectedPersonId: string | null, verb: string): void {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác được');
    if (expectedPersonId === null) throw new ConflictException('Chưa có người giữ vị trí cấp trên để thực hiện bước này');
    if (actor.personId !== expectedPersonId) throw new ForbiddenException(`Bạn không phải người có thẩm quyền ${verb} cán bộ này`);
  }

  private assertSubject(actor: Actor, assignment: AssignmentModel): void {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác được');
    if (actor.personId !== assignment.assigneePersonId) throw new ForbiddenException('Chỉ người được giao việc mới báo cáo hoàn thành');
  }

  private async assertCanView(actor: Actor, assignment: AssignmentModel, canReadAll: boolean): Promise<void> {
    if (canReadAll) return;
    if (assignment.assignerAccountId === actor.id) return;
    if (!actor.personId) throw new ForbiddenException('Bạn không có quyền xem việc này');
    if (actor.personId === assignment.assigneePersonId || actor.personId === assignment.approverPersonId) return;
    if ((await this.org.superiorHolders(assignment.assigneePersonId, assignment.positionId)).includes(actor.personId)) return;
    if ((await this.consultants.findByAssignments([assignment.id])).some((c) => c.personId === actor.personId)) return;
    throw new ForbiddenException('Bạn không có quyền xem việc này');
  }

  /**
   * Vai trò của người thao tác trong một việc (ADR-024 mục 4): người giao, người nhận, người duyệt (cc, hoặc cấp trên trực
   * tiếp khi không chỉ định), người tham vấn. Không có vai trò nào thì không phải thành viên.
   */
  async membership(actor: Actor, assignment: AssignmentModel): Promise<{ assigner: boolean; assignee: boolean; approver: boolean; consultant: boolean }> {
    const direct = await this.confirmerOf(assignment.assigneePersonId, assignment.positionId);
    const approverId = assignment.approverPersonId ?? direct;
    const consultant = actor.personId ? (await this.consultants.findByAssignments([assignment.id])).some((c) => c.personId === actor.personId) : false;
    return {
      assigner: assignment.assignerAccountId === actor.id || (actor.personId !== null && actor.personId === direct),
      assignee: actor.personId !== null && actor.personId === assignment.assigneePersonId,
      approver: actor.personId !== null && actor.personId === approverId,
      consultant,
    };
  }

  /**
   * Các việc mà người dùng là thành viên (người nhận, người giao, người duyệt, người tham vấn, cấp trên trực tiếp của người nhận),
   * hoặc tất cả khi có quyền xem toàn bộ. Dùng để gom tệp (ADR-025).
   */
  async memberWorks(actor: Actor, canReadAll: boolean): Promise<{ assignmentId: string; taskTitle: string; catalogItemCode: string; assigneePersonId: string }[]> {
    const lists: AssignmentModel[][] = [];
    if (canReadAll) {
      lists.push(await this.assignments.findAll());
    } else {
      lists.push(await this.assignments.findByAssigner(actor.id));
      if (actor.personId) {
        lists.push(await this.assignments.findByAssignees([actor.personId]));
        lists.push(await this.assignments.findByApprover(actor.personId));
        lists.push(await this.assignments.findByIds(await this.consultants.findAssignmentIds(actor.personId)));
        lists.push(await this.assignments.findByAssignees(await this.org.subordinateHolders(actor.personId, { direct: true })));
      }
    }
    const unique = new Map(lists.flat().map((a) => [a.id, a]));
    const taskById = new Map((await this.workTasks.findByIds([...new Set([...unique.values()].map((a) => a.taskId))])).map((t) => [t.id, t]));
    return [...unique.values()].map((a) => ({
      assignmentId: a.id,
      taskTitle: taskById.get(a.taskId)?.title ?? '',
      catalogItemCode: a.catalogItemCode,
      assigneePersonId: a.assigneePersonId,
    }));
  }

  /** Những người liên quan đến việc (người nhận, người duyệt, cấp trên trực tiếp, người tham vấn), trừ `except`. Dùng để gửi thông báo. */
  async participantsOf(assignment: AssignmentModel, except: string | null): Promise<string[]> {
    const consultants = (await this.consultants.findByAssignments([assignment.id])).map((c) => c.personId);
    const all = [assignment.assigneePersonId, await this.approverOf(assignment), await this.confirmerOf(assignment.assigneePersonId, assignment.positionId), ...consultants];
    return [...new Set(all.filter((p): p is string => p !== null && p !== except))];
  }

  /** Tên nhiệm vụ chứa việc, dùng làm tiêu đề thông báo. */
  async titleOf(assignment: AssignmentModel): Promise<string> {
    return (await this.requireTask(assignment.taskId)).title;
  }

  /** Việc theo mã (không kiểm tra quyền), dùng cho trao đổi và tệp; nơi gọi tự kiểm tra thành viên. */
  requireExisting(id: string): Promise<AssignmentModel> {
    return this.require(id);
  }

  /** Người duyệt thực tế: người duyệt (cc) nếu có, không thì cấp trên trực tiếp. */
  private async approverOf(assignment: AssignmentModel): Promise<string | null> {
    return assignment.approverPersonId ?? (await this.confirmerOf(assignment.assigneePersonId, assignment.positionId));
  }

  /** Người duyệt phải là cấp trên của người nhận; người tham vấn là cán bộ đang quản lý, khác người nhận, tối đa 10. */
  private async checkParticipants(
    assigneePersonId: string,
    approver: string | null | undefined,
    consultants: readonly string[] | undefined,
    positionId?: string | null,
  ): Promise<{ approverId: string | null; consultantIds: string[] }> {
    let approverId: string | null = null;
    if (approver) {
      if (!(await this.org.superiorHolders(assigneePersonId, positionId)).includes(approver)) {
        throw new BadRequestException('Người duyệt (cc) phải là một cấp trên của người nhận việc');
      }
      approverId = approver;
    }
    const consultantIds = [...new Set(consultants ?? [])];
    if (consultantIds.length > MAX_CONSULTANTS) throw new BadRequestException(`Tối đa ${MAX_CONSULTANTS} người tham vấn`);
    if (consultantIds.includes(assigneePersonId)) throw new BadRequestException('Người nhận việc không thể là người tham vấn');
    const active = await this.org.activePersonIds(consultantIds);
    if (consultantIds.some((id) => !active.has(id))) throw new BadRequestException('Có người tham vấn không tồn tại hoặc đã ngừng quản lý');
    return { approverId, consultantIds };
  }

  /**
   * Sửa nội dung, người duyệt (cc), người tham vấn của một việc còn mở. Người giao (cấp trên trực tiếp hoặc tài khoản đã giao)
   * mới được sửa. Bỏ qua trường không nêu; `approverPersonId: null` là quay về cấp trên trực tiếp.
   */
  async update(
    actor: Actor,
    id: string,
    patch: { note?: string | null; approverPersonId?: string | null; consultantPersonIds?: string[]; keyResult?: string | null },
  ): Promise<AssignmentView> {
    const assignment = await this.require(id);
    const roles = await this.membership(actor, assignment);
    if (!roles.assigner) throw new ForbiddenException('Chỉ người giao việc mới sửa được nội dung, người duyệt và người tham vấn');
    if (assignment.status !== 'OPEN') throw new ConflictException('Việc đã bị hủy, không sửa được');
    if (patch.note !== undefined) assertContent(patch.note);

    const next: { note?: string | null; approverPersonId?: string | null; okrKeyResult?: string | null } = {};
    if (patch.note !== undefined) next.note = patch.note?.trim() || null;
    if (patch.keyResult !== undefined) next.okrKeyResult = await this.resolveKeyResult(assignment.assigneePersonId, patch.keyResult);
    let consultantIds: string[] | undefined;
    if (patch.approverPersonId !== undefined || patch.consultantPersonIds !== undefined) {
      const people = await this.checkParticipants(
        assignment.assigneePersonId,
        patch.approverPersonId === undefined ? assignment.approverPersonId : patch.approverPersonId,
        patch.consultantPersonIds ?? (await this.consultants.findByAssignments([id])).map((c) => c.personId),
        assignment.positionId,
      );
      if (patch.approverPersonId !== undefined) next.approverPersonId = people.approverId;
      if (patch.consultantPersonIds !== undefined) consultantIds = people.consultantIds;
    }
    const updated = await this.assignments.update(id, next);
    if (consultantIds) await this.consultants.replace(id, consultantIds);
    await this.audit.record({
      action: 'tasking.assignment.update',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      targetId: id,
      details: {
        changed: Object.keys(patch),
        before: snapshot(assignment, ['note', 'approverPersonId', 'okrKeyResult'].filter((k) => k in next)),
        after: snapshot(updated, ['note', 'approverPersonId', 'okrKeyResult'].filter((k) => k in next)),
        approverPersonId: updated.approverPersonId,
        ...(patch.keyResult !== undefined ? { okrKeyResult: updated.okrKeyResult } : {}),
        ...(consultantIds ? { consultants: consultantIds.length } : {}),
      },
    });
    return (await this.views([updated]))[0];
  }

  /**
   * Theo dõi việc có lọc và phân trang (ADR-024 mục 7). Trạng thái suy ra từ báo cáo nên lọc theo trạng thái, sắp xếp và cắt
   * trang làm sau khi nạp các việc trong phạm vi.
   */
  async search(actor: Actor, query: SearchQuery, canReadAll: boolean): Promise<SearchResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('Trang phải là số nguyên từ 1');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('Cỡ trang từ 1 đến 100');
    const { filtered, matched } = await this.select(actor, query, canReadAll);
    const stateCounts = Object.fromEntries(ASSIGNMENT_STATES.map((s) => [s, 0])) as Record<AssignmentState, number>;
    for (const v of filtered) stateCounts[v.state] += 1;
    return { items: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize, stateCounts };
  }

  /** Lọc và sắp xếp việc trong phạm vi: `filtered` chưa lọc theo trạng thái (để đếm), `matched` đã lọc theo trạng thái và sắp xếp. */
  private async select(actor: Actor, query: SearchQuery, canReadAll: boolean): Promise<{ filtered: AssignmentView[]; matched: AssignmentView[] }> {
    for (const d of [query.dueFrom, query.dueTo, query.createdFrom, query.createdTo]) {
      if (d !== undefined && !isIsoDate(d)) throw new BadRequestException('Ngày lọc có dạng YYYY-MM-DD');
    }
    for (const s of query.states ?? []) {
      if (!ASSIGNMENT_STATES.includes(s)) throw new BadRequestException(`Trạng thái không hợp lệ: ${s}`);
    }
    if (query.kind !== undefined && !WORK_KINDS.includes(query.kind)) throw new BadRequestException('Loại việc là CATALOG, AD_HOC hoặc RECURRING');

    const base = await this.views(await this.rowsOfScope(actor, query.scope, canReadAll));
    // Mỗi từ khóa phải xuất hiện (thứ tự bất kỳ, bỏ dấu câu): "van thu luu tru" khớp "Văn thư, lưu trữ".
    const words = fold(query.q ?? '').split(/[\s,.;:]+/).filter(Boolean);
    const filtered = base.filter((v) => {
      const a = v.assignment;
      if (query.assigneePersonId && a.assigneePersonId !== query.assigneePersonId) return false;
      if (query.kind && workKindOf(a) !== query.kind) return false;
      if (query.dueFrom && a.dueDate < query.dueFrom) return false;
      if (query.dueTo && a.dueDate > query.dueTo) return false;
      const created = todayVietnam(a.createdAt);
      if (query.createdFrom && created < query.createdFrom) return false;
      if (query.createdTo && created > query.createdTo) return false;
      if (words.length > 0) {
        const haystack = fold(`${v.task.title} ${v.itemName} ${a.catalogItemCode} ${a.note ?? ''}`);
        if (!words.every((w) => haystack.includes(w))) return false;
      }
      return true;
    });

    const states = query.states ?? [];
    const matched = states.length > 0 ? filtered.filter((v) => states.includes(v.state)) : filtered;
    const sort = query.sort ?? 'due';
    matched.sort((x, y) =>
      sort === 'created'
        ? y.assignment.createdAt.getTime() - x.assignment.createdAt.getTime()
        : sort === 'dueDesc'
          ? y.assignment.dueDate.localeCompare(x.assignment.dueDate)
          : x.assignment.dueDate.localeCompare(y.assignment.dueDate),
    );
    return { filtered, matched };
  }

  /** Việc theo bộ lọc của danh sách (bỏ phân trang), kèm tên và vị trí; tối đa `MAX_EXPORT_ROWS`. */
  private async exportViews(actor: Actor, query: SearchQuery, canReadAll: boolean, limit: number): Promise<{ views: AssignmentView[]; truncated: boolean }> {
    const { matched } = await this.select(actor, { ...query, scope: query.scope ?? 'mine' }, canReadAll);
    return { views: matched.slice(0, limit), truncated: matched.length > limit };
  }

  /** Thống kê (trạng thái, tỷ lệ chậm, chưa đạt, theo đơn vị) trên các việc theo bộ lọc (PLAN-A A6.4). */
  async statistics(actor: Actor, query: SearchQuery, canReadAll: boolean): Promise<TaskStatistics> {
    const { filtered } = await this.select(actor, { ...query, scope: query.scope ?? 'mine' }, canReadAll);
    const states = query.states ?? [];
    return taskStatistics(states.length > 0 ? filtered.filter((v) => states.includes(v.state)) : filtered, await this.org.lookup());
  }

  /** Xuất danh sách việc theo bộ lọc ra Excel hoặc PDF, kèm thống kê. Ghi nhật ký (A6.5). */
  async exportAssignments(actor: Actor, query: SearchQuery, canReadAll: boolean, format: TableFormat): Promise<ExportedTable> {
    const { views, truncated } = await this.exportViews(actor, query, canReadAll, MAX_EXPORT_ROWS[format]);
    const scopeText: Record<SearchScope, string> = { mine: 'Việc của tôi', team: 'Việc của cấp dưới', all: 'Tất cả', consulted: 'Được tham vấn', approving: 'Chờ tôi duyệt', assigned: 'Tôi đã giao' };
    const now = this.clock.now();
    const info: [string, string][] = [['Phạm vi', scopeText[query.scope ?? 'mine']]];
    if (query.q) info.push(['Từ khóa', query.q]);
    if (query.kind) info.push(['Loại việc', { CATALOG: 'Giao từ danh mục', AD_HOC: 'Đột xuất', RECURRING: 'Định kỳ' }[query.kind]]);
    if (query.states?.length) info.push(['Trạng thái', query.states.join(', ')]);
    if (query.dueFrom || query.dueTo) info.push(['Hạn', `${query.dueFrom ?? '…'} đến ${query.dueTo ?? '…'}`]);
    if (truncated) info.push(['Lưu ý', `Chỉ xuất ${views.length} việc đầu tiên; hãy thu hẹp bộ lọc để xuất đủ.`]);
    const file = await buildExportFile('viec-duoc-giao', buildTaskExport(views, await this.org.lookup(), info, now), format);
    await this.audit.record({
      action: 'tasking.export',
      outcome: 'SUCCESS',
      targetType: 'work_assignment',
      details: { format, scope: query.scope ?? 'mine', rows: views.length, truncated, bytes: file.buffer.length, q: query.q, states: query.states, dueFrom: query.dueFrom, dueTo: query.dueTo },
    });
    return file;
  }

  private async rowsOfScope(actor: Actor, scope: SearchScope, canReadAll: boolean): Promise<AssignmentModel[]> {
    if (scope === 'all') {
      if (!canReadAll) throw new ForbiddenException('Bạn không có quyền xem toàn bộ việc được giao');
      return this.assignments.findAll();
    }
    if (scope === 'assigned') return this.assignments.findByAssigner(actor.id);
    if (!actor.personId) return [];
    switch (scope) {
      case 'mine':
        return this.assignments.findByAssignees([actor.personId]);
      case 'team':
        return this.assignments.findByAssignees(await this.org.subordinateHolders(actor.personId, { direct: false }));
      case 'consulted':
        return this.assignments.findByIds(await this.consultants.findAssignmentIds(actor.personId));
      case 'approving': {
        const explicit = await this.assignments.findByApprover(actor.personId);
        const direct = (await this.assignments.findByAssignees(await this.org.subordinateHolders(actor.personId, { direct: true }))).filter((a) => a.approverPersonId === null);
        return [...explicit, ...direct];
      }
      default:
        throw new BadRequestException('Phạm vi không hợp lệ');
    }
  }

  private async requireTask(id: string): Promise<WorkTaskModel> {
    const task = await this.workTasks.findById(id);
    if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ: ${id}`);
    return task;
  }

  private async require(id: string): Promise<AssignmentModel> {
    const assignment = await this.assignments.findById(id);
    if (!assignment) throw new NotFoundException(`Không tìm thấy việc được giao: ${id}`);
    return assignment;
  }

  private async views(rows: AssignmentModel[]): Promise<AssignmentView[]> {
    if (rows.length === 0) return [];
    const progress = await this.progress.findByAssignments(rows.map((r) => r.id));
    const taskById = new Map((await this.workTasks.findByIds([...new Set(rows.map((r) => r.taskId))])).map((t) => [t.id, t]));
    const consultantRows = await this.consultants.findByAssignments(rows.map((r) => r.id));
    const today = todayVietnam(this.clock.now());
    const versions = new Map<string, Awaited<ReturnType<CatalogDirectory['itemsOf']>>>();
    const confirmers = new Map<string, string | null>();
    const out: AssignmentView[] = [];
    for (const a of rows) {
      if (!versions.has(a.catalogVersionId)) versions.set(a.catalogVersionId, await this.catalog.itemsOf(a.catalogVersionId));
      const confirmerKey = `${a.assigneePersonId}|${a.positionId ?? ''}`;
      if (!confirmers.has(confirmerKey)) confirmers.set(confirmerKey, await this.confirmerOf(a.assigneePersonId, a.positionId));
      out.push(
        this.view(
          a,
          progress.filter((p) => p.assignmentId === a.id),
          a.approverPersonId ?? confirmers.get(confirmerKey) ?? null,
          versions.get(a.catalogVersionId) ?? new Map(),
          taskById.get(a.taskId),
          consultantRows.filter((c) => c.assignmentId === a.id).map((c) => c.personId),
          today,
        ),
      );
    }
    return out.sort((x, y) => x.assignment.dueDate.localeCompare(y.assignment.dueDate));
  }

  private view(
    assignment: AssignmentModel,
    progress: ProgressModel[],
    confirmerPersonId: string | null,
    items: Map<string, { name: string; coefficient: number | null }>,
    task: WorkTaskModel | undefined,
    consultantPersonIds: string[],
    today: string,
  ): AssignmentView {
    const item = items.get(assignment.catalogItemCode);
    const summary = summarize(assignment, progress);
    const adHoc = assignment.source === 'AD_HOC';
    return {
      assignment,
      task: { id: assignment.taskId, title: task?.title ?? '' },
      itemName: adHoc ? (assignment.title ?? adHocLabel(assignment.catalogItemCode) ?? assignment.catalogItemCode) : (item?.name ?? assignment.catalogItemCode),
      coefficient: adHoc ? adHocCoefficient(assignment.catalogItemCode) : (item?.coefficient ?? null),
      adHocLevel: adHoc ? adHocLevelOf(assignment.catalogItemCode) : null,
      progress: [...progress].sort((a, b) => a.completedOn.localeCompare(b.completedOn)),
      summary,
      confirmerPersonId,
      approverPersonId: assignment.approverPersonId,
      consultantPersonIds,
      state: stateOf(assignment, summary, today),
    };
  }
}

/** Loại việc để lọc: việc do mẫu lặp sinh ra là RECURRING dù giao từ danh mục hay đột xuất. */
export function workKindOf(a: Pick<AssignmentModel, 'source' | 'recurringTemplateId'>): WorkKind {
  return a.recurringTemplateId ? 'RECURRING' : a.source === 'AD_HOC' ? 'AD_HOC' : 'CATALOG';
}
