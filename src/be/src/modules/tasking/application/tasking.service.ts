import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { isInScope } from '../../../common/scope.js';
import { Notifier } from '../../../common/notifier.js';
import { AuditService } from '../../security/index.js';
import { ASSIGNMENT_STATES, belongsToPeriod, isIsoDate, MAX_CONSULTANTS, MAX_CONTENT_LENGTH, MAX_QUANTITY, REPORT_KINDS, stateOf, summarize, todayVietnam } from './tasking.model.js';
import type {
  AssignedWork,
  AssignmentModel,
  AssignmentState,
  PeriodMode,
  PeriodRange,
  ProgressModel,
  ProgressSummary,
  ReportKind,
  WorkTaskModel,
} from './tasking.model.js';
import { AssignmentRepository, CatalogDirectory, ConsultantRepository, OrgDirectory, ProgressRepository, WorkTaskRepository } from './tasking.ports.js';

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
}

export interface AssignInput {
  /** Nhiệm vụ chứa công việc; cán bộ nhận việc là người của nhiệm vụ đó. */
  taskId: string;
  catalogItemCode: string;
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
}

export type ListScope = 'mine' | 'team' | 'all';
/** Phạm vi theo dõi việc: ngoài ba phạm vi cũ còn được tham vấn, tôi là người duyệt, tôi đã giao (ADR-024). */
export type SearchScope = ListScope | 'consulted' | 'approving' | 'assigned';

export interface SearchQuery {
  scope: SearchScope;
  q?: string;
  states?: AssignmentState[];
  assigneePersonId?: string;
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

  /** Giao một việc trong danh mục, thuộc một nhiệm vụ, cho cấp dưới trực tiếp. */
  async assign(actor: Actor, input: AssignInput): Promise<AssignmentView> {
    const task = await this.requireTask(input.taskId);
    const assigneePersonId = task.assigneePersonId;
    const confirmer = await this.confirmerOf(assigneePersonId);
    this.assertActor(actor, confirmer, 'giao việc cho');

    assertQuantity(input.plannedQuantity, 'Số lượng giao');
    if (!isIsoDate(input.dueDate)) throw new BadRequestException('Hạn hoàn thành phải có dạng YYYY-MM-DD');
    const kinds = this.resolveKinds(input.periodMode, input.reportKinds);
    assertContent(input.note);
    const people = await this.checkParticipants(assigneePersonId, input.approverPersonId, input.consultantPersonIds);

    const current = await this.catalog.currentApproved();
    if (!current) throw new ConflictException('Chưa có danh mục sản phẩm công việc nào được phê duyệt');
    const item = current.items.get(input.catalogItemCode);
    if (!item) throw new NotFoundException(`Công việc ${input.catalogItemCode} không có trong danh mục đang hiệu lực`);
    if (item.coefficient === null || item.coefficient <= 0) {
      throw new ConflictException(`Công việc ${input.catalogItemCode} chưa có điểm chấm nên chưa giao được`);
    }
    const scope = { unitIds: item.unitIds ?? [], positionIds: item.positionIds ?? [] };
    if (!isInScope(scope, await this.org.placementOf(assigneePersonId))) {
      throw new ConflictException(`Công việc ${input.catalogItemCode} không thuộc phạm vi áp dụng của đơn vị, vị trí của người nhận`);
    }

    const created = await this.assignments.create({
      taskId: task.id,
      assigneePersonId,
      assignerAccountId: actor.id,
      catalogItemCode: input.catalogItemCode,
      catalogVersionId: current.versionId,
      plannedQuantity: input.plannedQuantity,
      dueDate: input.dueDate,
      periodMode: input.periodMode,
      reportKinds: kinds,
      note: input.note?.trim() || null,
      approverPersonId: people.approverId,
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
        code: created.catalogItemCode,
        plannedQuantity: created.plannedQuantity,
        dueDate: created.dueDate,
        periodMode: created.periodMode,
        reportKinds: created.reportKinds,
        approverPersonId: people.approverId,
        consultants: people.consultantIds.length,
      },
    });
    const link = `/tasks?open=${created.id}`;
    const others = (ids: readonly (string | null)[]) => ids.filter((p) => p !== actor.personId && p !== assigneePersonId);
    await this.notifier.notify([assigneePersonId], { type: 'TASK_ASSIGNED', title: `Bạn được giao việc: ${task.title}`, link });
    await this.notifier.notify(others([people.approverId]), { type: 'TASK_ROLE', title: `Bạn được chỉ định duyệt kết quả việc: ${task.title}`, link });
    await this.notifier.notify(others(people.consultantIds), { type: 'TASK_ROLE', title: `Bạn được mời tham vấn việc: ${task.title}`, link });
    return this.view(created, [], people.approverId ?? confirmer, new Map(current.items), task, people.consultantIds, todayVietnam(this.clock.now()));
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
    this.assertActor(actor, await this.confirmerOf(assignment.assigneePersonId), 'hủy việc của');
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
  private async confirmerOf(personId: string): Promise<string | null> {
    return (await this.org.superiorHolders(personId))[0] ?? null;
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
    if ((await this.org.superiorHolders(assignment.assigneePersonId)).includes(actor.personId)) return;
    if ((await this.consultants.findByAssignments([assignment.id])).some((c) => c.personId === actor.personId)) return;
    throw new ForbiddenException('Bạn không có quyền xem việc này');
  }

  /**
   * Vai trò của người thao tác trong một việc (ADR-024 mục 4): người giao, người nhận, người duyệt (cc, hoặc cấp trên trực
   * tiếp khi không chỉ định), người tham vấn. Không có vai trò nào thì không phải thành viên.
   */
  async membership(actor: Actor, assignment: AssignmentModel): Promise<{ assigner: boolean; assignee: boolean; approver: boolean; consultant: boolean }> {
    const direct = await this.confirmerOf(assignment.assigneePersonId);
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
    const all = [assignment.assigneePersonId, await this.approverOf(assignment), await this.confirmerOf(assignment.assigneePersonId), ...consultants];
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
    return assignment.approverPersonId ?? (await this.confirmerOf(assignment.assigneePersonId));
  }

  /** Người duyệt phải là cấp trên của người nhận; người tham vấn là cán bộ đang quản lý, khác người nhận, tối đa 10. */
  private async checkParticipants(
    assigneePersonId: string,
    approver: string | null | undefined,
    consultants: readonly string[] | undefined,
  ): Promise<{ approverId: string | null; consultantIds: string[] }> {
    let approverId: string | null = null;
    if (approver) {
      if (!(await this.org.superiorHolders(assigneePersonId)).includes(approver)) {
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
    patch: { note?: string | null; approverPersonId?: string | null; consultantPersonIds?: string[] },
  ): Promise<AssignmentView> {
    const assignment = await this.require(id);
    const roles = await this.membership(actor, assignment);
    if (!roles.assigner) throw new ForbiddenException('Chỉ người giao việc mới sửa được nội dung, người duyệt và người tham vấn');
    if (assignment.status !== 'OPEN') throw new ConflictException('Việc đã bị hủy, không sửa được');
    if (patch.note !== undefined) assertContent(patch.note);

    const next: { note?: string | null; approverPersonId?: string | null } = {};
    if (patch.note !== undefined) next.note = patch.note?.trim() || null;
    let consultantIds: string[] | undefined;
    if (patch.approverPersonId !== undefined || patch.consultantPersonIds !== undefined) {
      const people = await this.checkParticipants(
        assignment.assigneePersonId,
        patch.approverPersonId === undefined ? assignment.approverPersonId : patch.approverPersonId,
        patch.consultantPersonIds ?? (await this.consultants.findByAssignments([id])).map((c) => c.personId),
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
        approverPersonId: updated.approverPersonId,
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
    for (const d of [query.dueFrom, query.dueTo, query.createdFrom, query.createdTo]) {
      if (d !== undefined && !isIsoDate(d)) throw new BadRequestException('Ngày lọc có dạng YYYY-MM-DD');
    }
    for (const s of query.states ?? []) {
      if (!ASSIGNMENT_STATES.includes(s)) throw new BadRequestException(`Trạng thái không hợp lệ: ${s}`);
    }

    const base = await this.views(await this.rowsOfScope(actor, query.scope, canReadAll));
    // Mỗi từ khóa phải xuất hiện (thứ tự bất kỳ, bỏ dấu câu): "van thu luu tru" khớp "Văn thư, lưu trữ".
    const words = fold(query.q ?? '').split(/[\s,.;:]+/).filter(Boolean);
    const filtered = base.filter((v) => {
      const a = v.assignment;
      if (query.assigneePersonId && a.assigneePersonId !== query.assigneePersonId) return false;
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

    const stateCounts = Object.fromEntries(ASSIGNMENT_STATES.map((s) => [s, 0])) as Record<AssignmentState, number>;
    for (const v of filtered) stateCounts[v.state] += 1;

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
    return { items: matched.slice((page - 1) * pageSize, page * pageSize), total: matched.length, page, pageSize, stateCounts };
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
      if (!confirmers.has(a.assigneePersonId)) confirmers.set(a.assigneePersonId, await this.confirmerOf(a.assigneePersonId));
      out.push(
        this.view(
          a,
          progress.filter((p) => p.assignmentId === a.id),
          a.approverPersonId ?? confirmers.get(a.assigneePersonId) ?? null,
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
    return {
      assignment,
      task: { id: assignment.taskId, title: task?.title ?? '' },
      itemName: item?.name ?? assignment.catalogItemCode,
      coefficient: item?.coefficient ?? null,
      progress: [...progress].sort((a, b) => a.completedOn.localeCompare(b.completedOn)),
      summary,
      confirmerPersonId,
      approverPersonId: assignment.approverPersonId,
      consultantPersonIds,
      state: stateOf(assignment, summary, today),
    };
  }
}
