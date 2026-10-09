import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import { isInScope } from '../../../common/scope.js';
import { AuditService } from '../../security/index.js';
import { MAX_GENERAL_SCORE } from '../../scoring/index.js';
import { MAX_QUANTITY, QUALITY_LEVELS } from './evaluation.model.js';
import type {
  EvaluationModel,
  PeriodModel,
  PeriodType,
  TaskModel,
  TaskPatch,
} from './evaluation.model.js';
import { CatalogDirectory, EvaluationRepository, OrgDirectory, PeriodRepository, PeriodWorkSource, TaskRepository } from './evaluation.ports.js';
import type { CatalogVersionInfo, PeriodWork } from './evaluation.ports.js';
import { buildPeriod } from './period.js';
import { DEFAULT_SCORING_PARAMS, evaluate, LEADERSHIP_LEVELS } from './scoring-policy.js';
import type { Evaluated, KpiBreakdown, Leadership, ScoredTask } from './scoring-policy.js';

/** Người thao tác: tài khoản đang đăng nhập và cán bộ gắn với tài khoản đó (có thể chưa gắn). */
export interface Actor {
  id: string;
  username: string;
  personId: string | null;
}

export interface TaskView extends TaskModel {
  name: string;
  coefficient: number | null;
}

export interface EvaluationView {
  evaluation: EvaluationModel;
  period: PeriodModel;
  tasks: TaskView[];
  /** Điểm tạm tính khi chưa thẩm định; điểm đã chốt khi đã thẩm định hoặc phê duyệt. */
  preview: Omit<Evaluated, 'breakdown'> & { breakdown: KpiBreakdown | null };
  /** Cán bộ lãnh đạo, quản lý (cấp 1–4) được chấm thêm tiêu chí D. */
  isLeader: boolean;
  /** Gợi ý cho tiêu chí D "kết quả hoạt động của đơn vị" từ xếp loại của cấp dưới trong cùng kỳ (null nếu chưa có dữ liệu). */
  leadershipSuggestion: { unitResult: number | null } | null;
  /** Cảnh báo theo quy định chưa được hệ thống tự áp dụng. */
  warnings: string[];
  /** Người thẩm định và phê duyệt hiện tại theo cây tổ chức (null nếu không có). */
  reviewerPersonId: string | null;
  approverPersonId: string | null;
}

export interface GenerateResult {
  period: string;
  /** Số hồ sơ mới tạo và số hồ sơ đã có được làm mới. */
  created: number;
  refreshed: number;
  /** Cán bộ không điền được kèm lý do (không giữ vị trí, hồ sơ đã qua bước tự chấm...). */
  skipped: { personId: string; reason: string }[];
  warnings: string[];
  evaluations: { evaluationId: string; personId: string; lines: number; created: boolean }[];
}

export interface ReviewInput {
  generalScore: number;
  /** Bắt buộc với cán bộ lãnh đạo, quản lý; không được gửi với người khác. */
  leadership?: Leadership;
  comment?: string | null;
  tasks: { taskId: string; qualityLevel?: number; completedQuantity?: number }[];
}

interface Authority {
  /** Các cán bộ đang giữ vị trí cấp trên, từ gần đến xa, đã bỏ vị trí trống. */
  holders: string[];
  reviewer: string | null;
  approver: string | null;
}

/**
 * Đánh giá theo kỳ (ADR-014). Quyền vai trò kiểm tra ở lớp trình bày; ở đây kiểm tra phạm vi theo cây
 * vị trí (ai là cấp trên của ai) và trạng thái hồ sơ.
 */
@Injectable()
export class EvaluationService {
  constructor(
    private readonly periods: PeriodRepository,
    private readonly evaluations: EvaluationRepository,
    private readonly tasks: TaskRepository,
    private readonly org: OrgDirectory,
    private readonly catalog: CatalogDirectory,
    private readonly work: PeriodWorkSource,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  // ---------------------------------------------------------------- kỳ đánh giá

  listPeriods(): Promise<PeriodModel[]> {
    return this.periods.findAll();
  }

  async createPeriod(
    actor: Actor,
    input: { type: PeriodType; year: number; number?: number | null; catalogVersionId?: string },
  ): Promise<PeriodModel> {
    const spec = buildPeriod(input.type, input.year, input.number);
    if (await this.periods.findByLabel(spec.label)) throw new ConflictException(`Kỳ ${spec.label} đã tồn tại`);

    const catalogVersionId = input.catalogVersionId ?? (await this.catalog.currentApprovedVersionId());
    if (!catalogVersionId) throw new ConflictException('Chưa có danh mục sản phẩm công việc nào được phê duyệt để gắn với kỳ');
    const version = await this.catalog.getVersion(catalogVersionId);
    if (!version) throw new NotFoundException(`Không tìm thấy phiên bản danh mục: ${catalogVersionId}`);
    if (version.status !== 'APPROVED') throw new ConflictException('Kỳ chỉ gắn được với phiên bản danh mục đã phê duyệt');

    const created = await this.periods.create({ ...spec, catalogVersionId, createdBy: actor.id });
    await this.audit.record({
      action: 'evaluation.period.create',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: created.id,
      details: { label: created.label, catalogVersionId },
    });
    return created;
  }

  async closePeriod(periodId: string): Promise<void> {
    const period = await this.requirePeriod(periodId);
    if (period.status === 'CLOSED') return;
    await this.periods.close(periodId);
    await this.audit.record({
      action: 'evaluation.period.close',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { label: period.label },
    });
  }

  // ------------------------------------------------------------ hồ sơ và chỉ tiêu

  /** Bước 1: giao mục tiêu. Chỉ người thẩm định (cấp trên trực tiếp) của cán bộ mới tạo được hồ sơ. */
  async createEvaluation(actor: Actor, periodId: string, personId: string): Promise<EvaluationModel> {
    const period = await this.requirePeriod(periodId);
    this.assertOpen(period);
    const position = await this.org.positionOf(personId);
    if (!position) throw new ConflictException('Cán bộ hiện không giữ vị trí việc làm nào');
    const authority = await this.authority(personId);
    this.assertActor(actor, authority.reviewer, 'giao mục tiêu cho');
    if (await this.evaluations.findByPeriodAndPerson(periodId, personId)) {
      throw new ConflictException('Cán bộ đã có hồ sơ đánh giá trong kỳ này');
    }

    const created = await this.evaluations.create({ periodId, personId, positionId: position.positionId, createdBy: actor.id });
    await this.audit.record({
      action: 'evaluation.create',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: created.id,
      details: { period: period.label, personId },
    });
    return created;
  }

  /**
   * Văn phòng tạo hồ sơ từ việc (ADR-016 mục 5): với mỗi cán bộ có việc thuộc kỳ, tạo hồ sơ nếu chưa có và điền
   * các dòng chỉ tiêu đã gộp theo mã công việc. Hồ sơ từ bước tự chấm trở đi không bị đổi. Làm lại nhiều lần
   * cho cùng kỳ cho kết quả như nhau (làm mới các dòng có nguồn, giữ dòng nhập tay).
   */
  async generateFromWork(actor: Actor, periodId: string): Promise<GenerateResult> {
    const period = await this.requirePeriod(periodId);
    this.assertOpen(period);
    const version = await this.requireVersion(period);
    const collected = await this.work.collect({ type: period.type, startDate: period.startDate, endDate: period.endDate });

    const byPerson = new Map<string, PeriodWork[]>();
    for (const w of collected) byPerson.set(w.personId, [...(byPerson.get(w.personId) ?? []), w]);

    const result: GenerateResult = { period: period.label, created: 0, refreshed: 0, skipped: [], warnings: [], evaluations: [] };
    for (const [personId, items] of [...byPerson].sort(([a], [b]) => a.localeCompare(b))) {
      const position = await this.org.positionOf(personId);
      if (!position) {
        result.skipped.push({ personId, reason: 'Cán bộ hiện không giữ vị trí việc làm nào' });
        continue;
      }
      let evaluation = await this.evaluations.findByPeriodAndPerson(periodId, personId);
      if (evaluation && evaluation.status !== 'PLANNED') {
        result.skipped.push({ personId, reason: `Hồ sơ đang ở trạng thái ${evaluation.status}, không làm mới được` });
        continue;
      }

      const lines = new Map<string, ReturnType<typeof newLine>>();
      for (const w of items) {
        const info = version.items.get(w.catalogItemCode);
        if (!info || info.coefficient === null || info.coefficient <= 0) {
          result.warnings.push(`Việc ${w.catalogItemCode} (cán bộ ${personId}) không có trong danh mục của kỳ hoặc chưa có điểm chấm nên bị bỏ qua`);
          continue;
        }
        const line = lines.get(w.catalogItemCode) ?? newLine();
        line.planned += w.plannedQuantity;
        line.completed += w.confirmedQuantity;
        line.late += w.lateCount;
        line.rework += w.reworkCount;
        if (w.evidence) line.evidence.push(w.evidence);
        line.sources.push(w.assignmentId);
        if (w.taskTitle && !line.titles.includes(w.taskTitle)) line.titles.push(w.taskTitle);
        lines.set(w.catalogItemCode, line);
      }
      if (lines.size === 0 && !evaluation) {
        result.skipped.push({ personId, reason: 'Không có việc nào đủ điều kiện để điền' });
        continue;
      }

      const isNew = !evaluation;
      evaluation ??= await this.evaluations.create({ periodId, personId, positionId: position.positionId, createdBy: actor.id });
      const existing = await this.tasks.findByEvaluation(evaluation.id);
      for (const [code, line] of lines) {
        const data = {
          plannedQuantity: Math.min(line.planned, MAX_QUANTITY),
          completedQuantity: Math.min(line.completed, MAX_QUANTITY),
          evidence: line.evidence.length > 0 ? [...new Set(line.evidence)].join(' | ').slice(0, 2000) : null,
          sourceAssignmentIds: line.sources,
          sourceTaskTitles: line.titles,
          lateCount: line.late,
          reworkCount: line.rework,
        };
        const current = existing.find((t) => t.catalogItemCode === code);
        if (!current) await this.tasks.create({ evaluationId: evaluation.id, catalogItemCode: code, ...data });
        else if (current.sourceAssignmentIds.length > 0) await this.tasks.update(current.id, data);
        else result.warnings.push(`Hồ sơ của cán bộ ${personId} đã có dòng ${code} nhập tay nên không ghi đè`);
      }
      for (const t of existing) if (t.sourceAssignmentIds.length > 0 && !lines.has(t.catalogItemCode)) await this.tasks.delete(t.id);

      if (isNew) result.created += 1;
      else result.refreshed += 1;
      result.evaluations.push({ evaluationId: evaluation.id, personId, lines: lines.size, created: isNew });
    }

    // Hồ sơ còn PLANNED mà không còn việc nguồn nào (việc đã hủy): bỏ các dòng có nguồn đã lỗi thời.
    for (const evaluation of await this.evaluations.findByPeriod(periodId)) {
      if (evaluation.status !== 'PLANNED' || byPerson.has(evaluation.personId)) continue;
      for (const t of await this.tasks.findByEvaluation(evaluation.id)) {
        if (t.sourceAssignmentIds.length > 0) await this.tasks.delete(t.id);
      }
    }

    await this.audit.record({
      action: 'evaluation.generate',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: {
        period: period.label,
        created: result.created,
        refreshed: result.refreshed,
        skipped: result.skipped.length,
        warnings: result.warnings.length,
      },
    });
    return result;
  }

  async listEvaluations(actor: Actor, periodId: string, canReadAll: boolean): Promise<EvaluationModel[]> {
    await this.requirePeriod(periodId);
    const all = await this.evaluations.findByPeriod(periodId);
    if (canReadAll) return all;
    if (!actor.personId) return [];
    const visible: EvaluationModel[] = [];
    for (const e of all) if (await this.canView(actor, e, false)) visible.push(e);
    return visible;
  }

  async getEvaluation(actor: Actor, id: string, canReadAll: boolean): Promise<EvaluationView> {
    const { evaluation, period } = await this.load(id);
    if (!(await this.canView(actor, evaluation, canReadAll))) {
      throw new ForbiddenException('Bạn không có quyền xem hồ sơ đánh giá này');
    }
    return this.view(evaluation, period);
  }

  async addTask(actor: Actor, evaluationId: string, input: { catalogItemCode: string; plannedQuantity: number }): Promise<TaskModel> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['PLANNED']);
    this.assertActor(actor, (await this.authority(evaluation.personId)).reviewer, 'giao chỉ tiêu cho');
    assertQuantity(input.plannedQuantity, 1, 'Số lượng giao');

    const version = await this.requireVersion(period);
    const item = version.items.get(input.catalogItemCode);
    if (!item) throw new NotFoundException(`Công việc ${input.catalogItemCode} không có trong danh mục của kỳ này`);
    if (item.coefficient === null || item.coefficient <= 0) {
      throw new ConflictException(`Công việc ${input.catalogItemCode} chưa có điểm chấm nên chưa giao được`);
    }
    const placement = await this.org.positionOf(evaluation.personId);
    const scope = { unitIds: item.unitIds ?? [], positionIds: item.positionIds ?? [] };
    if (!isInScope(scope, placement?.unitId ? { unitId: placement.unitId, positionId: placement.positionId } : null)) {
      throw new ConflictException(`Công việc ${input.catalogItemCode} không thuộc phạm vi áp dụng của đơn vị, vị trí của người được đánh giá`);
    }
    const existing = await this.tasks.findByEvaluation(evaluationId);
    if (existing.some((t) => t.catalogItemCode === input.catalogItemCode)) {
      throw new ConflictException(`Hồ sơ đã có công việc ${input.catalogItemCode}, hãy sửa số lượng thay vì thêm lại`);
    }

    const created = await this.tasks.create({ evaluationId, catalogItemCode: input.catalogItemCode, plannedQuantity: input.plannedQuantity });
    await this.audit.record({
      action: 'evaluation.task.assign',
      outcome: 'SUCCESS',
      targetType: 'evaluation_task',
      targetId: created.id,
      details: { evaluationId, code: created.catalogItemCode, plannedQuantity: created.plannedQuantity },
    });
    return created;
  }

  async removeTask(actor: Actor, taskId: string): Promise<void> {
    const task = await this.requireTask(taskId);
    const { evaluation, period } = await this.load(task.evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['PLANNED']);
    this.assertActor(actor, (await this.authority(evaluation.personId)).reviewer, 'sửa chỉ tiêu của');
    if (task.sourceAssignmentIds.length > 0) {
      throw new ConflictException('Dòng này lấy từ việc được giao: hãy hủy việc rồi tạo lại hồ sơ từ việc');
    }
    await this.tasks.delete(taskId);
    await this.audit.record({
      action: 'evaluation.task.remove',
      outcome: 'SUCCESS',
      targetType: 'evaluation_task',
      targetId: taskId,
      details: { evaluationId: task.evaluationId, code: task.catalogItemCode },
    });
  }

  /** Bước 2 (một phần): cá nhân ghi số lượng hoàn thành và minh chứng của chính mình. */
  async recordResult(actor: Actor, taskId: string, input: { completedQuantity: number; evidence?: string | null }): Promise<TaskModel> {
    const task = await this.requireTask(taskId);
    const { evaluation, period } = await this.load(task.evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['PLANNED']);
    this.assertSubject(actor, evaluation);
    if (task.sourceAssignmentIds.length > 0) {
      throw new ConflictException('Kết quả của dòng này lấy từ việc đã được cấp trên xác nhận, không sửa trực tiếp');
    }
    assertQuantity(input.completedQuantity, 0, 'Số lượng hoàn thành');

    const before = { completedQuantity: task.completedQuantity, evidence: task.evidence };
    const updated = await this.tasks.update(taskId, { completedQuantity: input.completedQuantity, evidence: input.evidence ?? null });
    await this.audit.record({
      action: 'evaluation.task.result',
      outcome: 'SUCCESS',
      targetType: 'evaluation_task',
      targetId: taskId,
      details: { evaluationId: task.evaluationId, code: task.catalogItemCode, before, after: { completedQuantity: updated.completedQuantity } },
    });
    return updated;
  }

  /** Bước 2: cá nhân tự chấm và nộp. */
  async selfSubmit(actor: Actor, evaluationId: string, input: { generalScore: number; comment?: string | null }): Promise<EvaluationModel> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['PLANNED']);
    this.assertSubject(actor, evaluation);
    assertGeneralScore(input.generalScore);
    if ((await this.tasks.findByEvaluation(evaluationId)).length === 0) {
      throw new ConflictException('Hồ sơ chưa có chỉ tiêu nào để tự chấm');
    }

    const updated = await this.evaluations.update(evaluationId, {
      status: 'SELF_SUBMITTED',
      selfGeneralScore: input.generalScore,
      selfComment: input.comment ?? null,
      selfSubmittedAt: this.clock.now(),
      returnReason: null,
    });
    await this.audit.record({
      action: 'evaluation.self-submit',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluationId,
      details: { period: period.label, selfGeneralScore: input.generalScore },
    });
    await this.notifier.notify([(await this.authority(evaluation.personId)).reviewer], {
      type: 'EVAL_SELF_SUBMITTED',
      title: `Có hồ sơ đánh giá kỳ ${period.label} chờ bạn thẩm định`,
      link: `/evaluations/${evaluationId}`,
    });
    return updated;
  }

  /** Bước 3: cấp trên trực tiếp nhận xét, chấm tiêu chí chung, đặt mức chất lượng và đề xuất xếp loại. */
  async review(actor: Actor, evaluationId: string, input: ReviewInput): Promise<EvaluationView> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['SELF_SUBMITTED']);
    this.assertActor(actor, (await this.authority(evaluation.personId)).reviewer, 'thẩm định hồ sơ của');
    assertGeneralScore(input.generalScore);

    const current = await this.tasks.findByEvaluation(evaluationId);
    const byId = new Map(current.map((t) => [t.id, t]));
    const patches = new Map<string, TaskPatch>();
    for (const edit of input.tasks) {
      const task = byId.get(edit.taskId);
      if (!task) throw new NotFoundException(`Dòng chỉ tiêu ${edit.taskId} không thuộc hồ sơ này`);
      const patch: TaskPatch = {};
      if (edit.qualityLevel !== undefined) {
        if (!QUALITY_LEVELS.includes(edit.qualityLevel)) throw new BadRequestException('Mức chất lượng là 1, 2 hoặc 3');
        patch.qualityLevel = edit.qualityLevel;
      }
      if (edit.completedQuantity !== undefined) {
        assertQuantity(edit.completedQuantity, 0, 'Số lượng hoàn thành');
        if (edit.completedQuantity !== task.completedQuantity) patch.completedQuantity = edit.completedQuantity;
      }
      if (Object.keys(patch).length > 0) patches.set(task.id, { ...patches.get(task.id), ...patch });
    }

    // Kiểm tra trước khi ghi: không để lại thay đổi dở dang nếu hồ sơ chưa đủ điều kiện.
    const leader = await this.isLeader(evaluation.personId);
    const leadership = this.checkLeadership(input.leadership, leader);
    const prospective = current.map((t) => ({ ...t, ...patches.get(t.id) }));
    const version = await this.requireVersion(period);
    const result = evaluate(toScored(prospective, version), input.generalScore, DEFAULT_SCORING_PARAMS, leadership, leader);
    if (!result.complete) throw new ConflictException('Còn dòng đã có kết quả nhưng chưa đặt mức chất lượng');

    const changes: Record<string, unknown>[] = [];
    for (const [taskId, patch] of patches) {
      const before = byId.get(taskId)!;
      await this.tasks.update(taskId, patch);
      changes.push({
        code: before.catalogItemCode,
        before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof TaskModel]])),
        after: patch,
      });
    }

    const updated = await this.evaluations.update(evaluationId, {
      status: 'REVIEWED',
      generalScore: input.generalScore,
      reviewComment: input.comment ?? null,
      reviewerAccountId: actor.id,
      reviewedAt: this.clock.now(),
      resultScore: result.resultScore,
      totalScore: result.totalScore,
      rating: result.rating,
      scoringParams: { ...DEFAULT_SCORING_PARAMS, breakdown: result.breakdown, isLeader: leader },
      leadership,
      returnReason: null,
    });
    await this.audit.record({
      action: 'evaluation.review',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluationId,
      details: {
        period: period.label,
        generalScore: input.generalScore,
        resultScore: result.resultScore,
        totalScore: result.totalScore,
        rating: result.rating,
        policy: DEFAULT_SCORING_PARAMS.version,
        breakdown: result.breakdown,
        leadership,
        taskChanges: changes,
      },
    });
    await this.notifier.notify([(await this.authority(evaluation.personId)).approver], {
      type: 'EVAL_REVIEWED',
      title: `Có hồ sơ đánh giá kỳ ${period.label} chờ bạn phê duyệt`,
      link: `/evaluations/${evaluationId}`,
    });
    return this.view(updated, period);
  }

  /** Bước 4: người phê duyệt quyết định. Từ đây hồ sơ khóa. */
  async approve(actor: Actor, evaluationId: string, comment?: string | null): Promise<EvaluationView> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['REVIEWED']);
    this.assertActor(actor, (await this.authority(evaluation.personId)).approver, 'phê duyệt hồ sơ của');

    const updated = await this.evaluations.update(evaluationId, {
      status: 'APPROVED',
      approverAccountId: actor.id,
      approvedAt: this.clock.now(),
      approveComment: comment ?? null,
    });
    await this.audit.record({
      action: 'evaluation.approve',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluationId,
      details: { period: period.label, totalScore: updated.totalScore, rating: updated.rating },
    });
    await this.notifier.notify([evaluation.personId], { type: 'EVAL_APPROVED', title: `Hồ sơ đánh giá kỳ ${period.label} của bạn đã được phê duyệt`, link: `/evaluations/${evaluationId}` });
    return this.view(updated, period);
  }

  /** Trả hồ sơ về bước giao mục tiêu: người thẩm định trả hồ sơ đã tự chấm, người phê duyệt trả hồ sơ đã thẩm định. */
  async returnEvaluation(actor: Actor, evaluationId: string, reason: string): Promise<EvaluationModel> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['SELF_SUBMITTED', 'REVIEWED']);
    if (reason.trim().length < 3) throw new BadRequestException('Cần nêu lý do trả lại');

    const authority = await this.authority(evaluation.personId);
    const from = evaluation.status; // chụp trước khi cập nhật
    this.assertActor(actor, from === 'SELF_SUBMITTED' ? authority.reviewer : authority.approver, 'trả lại hồ sơ của');

    const updated = await this.evaluations.update(evaluationId, {
      status: 'PLANNED',
      generalScore: null,
      reviewComment: null,
      reviewerAccountId: null,
      reviewedAt: null,
      resultScore: null,
      totalScore: null,
      rating: null,
      scoringParams: null,
      leadership: null,
      returnReason: reason.trim(),
    });
    await this.audit.record({
      action: 'evaluation.return',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluationId,
      details: { period: period.label, from, reason: reason.trim() },
    });
    await this.notifier.notify([evaluation.personId], { type: 'EVAL_RETURNED', title: `Hồ sơ đánh giá kỳ ${period.label} bị trả lại, cần chỉnh sửa`, link: `/evaluations/${evaluationId}` });
    return updated;
  }

  // ------------------------------------------------------------------ nội bộ

  /** Người thẩm định là người đầu tiên giữ vị trí cấp trên; người phê duyệt là người kế tiếp (hoặc chính người đó nếu đã ở trên cùng). */
  private async authority(personId: string): Promise<Authority> {
    const holders = (await this.org.superiorsOf(personId)).flatMap((s) => (s.personId ? [s.personId] : []));
    return { holders, reviewer: holders[0] ?? null, approver: holders[1] ?? holders[0] ?? null };
  }

  private async canView(actor: Actor, evaluation: EvaluationModel, canReadAll: boolean): Promise<boolean> {
    if (canReadAll) return true;
    if (!actor.personId) return false;
    if (actor.personId === evaluation.personId) return true;
    return (await this.authority(evaluation.personId)).holders.includes(actor.personId);
  }

  private assertActor(actor: Actor, expectedPersonId: string | null, verb: string): void {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác đánh giá được');
    if (expectedPersonId === null) throw new ConflictException('Chưa có người giữ vị trí cấp trên để thực hiện bước này');
    if (actor.personId !== expectedPersonId) throw new ForbiddenException(`Bạn không phải người có thẩm quyền ${verb} cán bộ này`);
  }

  private assertSubject(actor: Actor, evaluation: EvaluationModel): void {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác đánh giá được');
    if (actor.personId !== evaluation.personId) throw new ForbiddenException('Chỉ chính cán bộ được thực hiện bước này cho hồ sơ của mình');
  }

  private assertStatus(evaluation: EvaluationModel, allowed: EvaluationModel['status'][]): void {
    if (!allowed.includes(evaluation.status)) {
      throw new ConflictException(`Hồ sơ đang ở trạng thái ${evaluation.status}, không thực hiện được thao tác này`);
    }
  }

  private assertOpen(period: PeriodModel): void {
    if (period.status !== 'OPEN') throw new ConflictException(`Kỳ ${period.label} đã đóng`);
  }

  private async view(evaluation: EvaluationModel, period: PeriodModel): Promise<EvaluationView> {
    const [tasks, version, authority] = await Promise.all([
      this.tasks.findByEvaluation(evaluation.id),
      this.requireVersion(period),
      this.authority(evaluation.personId),
    ]);
    const taskViews: TaskView[] = tasks.map((t) => {
      const info = version.items.get(t.catalogItemCode);
      return { ...t, name: info?.name ?? t.catalogItemCode, coefficient: info?.coefficient ?? null };
    });

    const frozen = evaluation.status === 'REVIEWED' || evaluation.status === 'APPROVED';
    const leader = await this.isLeader(evaluation.personId);
    const scored = toScored(tasks, version);
    const live = evaluate(scored, evaluation.generalScore ?? evaluation.selfGeneralScore, DEFAULT_SCORING_PARAMS, evaluation.leadership, leader);
    const stored = (evaluation.scoringParams?.breakdown ?? null) as KpiBreakdown | null;
    const preview: EvaluationView['preview'] =
      frozen && evaluation.resultScore !== null
        ? { resultScore: evaluation.resultScore, totalScore: evaluation.totalScore, rating: evaluation.rating, complete: true, breakdown: stored }
        : live;

    // Cảnh báo theo 05-HD/TU mục 8.2: chưa hoàn thành 100% số lượng giao thì xếp loại "Không hoàn thành nhiệm vụ",
    // trừ lý do khách quan được cấp có thẩm quyền xác nhận. Hệ thống chưa tự áp dụng (GAP G-18).
    const warnings: string[] = [];
    const quantity = (frozen ? stored : live.breakdown)?.quantity;
    if (tasks.length > 0 && quantity !== undefined && quantity < 1) {
      warnings.push(
        'Chưa hoàn thành đủ số lượng giao: theo 05-HD/TU mục 8.2, cá nhân hoàn thành dưới 100% nhiệm vụ giao trong kỳ thì xếp loại "Không hoàn thành nhiệm vụ", trừ lý do khách quan, bất khả kháng được cấp có thẩm quyền xác nhận. Hệ thống chưa tự áp dụng quy định này.',
      );
    }

    return {
      evaluation,
      period,
      tasks: taskViews,
      preview,
      reviewerPersonId: authority.reviewer,
      approverPersonId: authority.approver,
      isLeader: leader,
      leadershipSuggestion: leader ? { unitResult: await this.suggestUnitResult(evaluation) } : null,
      warnings,
    };
  }

  /** Cán bộ lãnh đạo, quản lý: người giữ vị trí có cờ lãnh đạo (ADR-022); chưa có cờ thì theo cấp 1–4 (G-21). */
  private async isLeader(personId: string): Promise<boolean> {
    const position = await this.org.positionOf(personId);
    return position !== null && (position.isLeader ?? position.level <= DEFAULT_SCORING_PARAMS.leaderMaxLevel);
  }

  private checkLeadership(input: Leadership | undefined, leader: boolean): Leadership | null {
    if (!leader) {
      if (input) throw new BadRequestException('Tiêu chí lãnh đạo, chỉ đạo (D) chỉ áp dụng cho cán bộ lãnh đạo, quản lý');
      return null;
    }
    if (!input) throw new BadRequestException('Cán bộ lãnh đạo, quản lý cần được chấm tiêu chí lãnh đạo, chỉ đạo (D)');
    for (const v of [input.unitResult, input.organizing, input.solidarity]) {
      if (!LEADERSHIP_LEVELS.includes(v)) throw new BadRequestException('Mỗi tiêu chí D đạt 100% (1) hoặc 50% (0,5)');
    }
    return { unitResult: input.unitResult, organizing: input.organizing, solidarity: input.solidarity };
  }

  /** 100% nếu mọi cấp dưới đã có kết quả trong kỳ đều từ hoàn thành trở lên; 50% nếu có người không hoàn thành; null nếu chưa có dữ liệu. */
  private async suggestUnitResult(evaluation: EvaluationModel): Promise<number | null> {
    const subordinates = new Set(await this.org.subordinateHolders(evaluation.personId, { direct: false }));
    if (subordinates.size === 0) return null;
    const rated = (await this.evaluations.findByPeriod(evaluation.periodId)).filter(
      (e) => subordinates.has(e.personId) && (e.status === 'REVIEWED' || e.status === 'APPROVED') && e.rating !== null,
    );
    if (rated.length === 0) return null;
    return rated.some((e) => e.rating === 'KHONG_HOAN_THANH') ? 0.5 : 1;
  }

  private async load(id: string): Promise<{ evaluation: EvaluationModel; period: PeriodModel }> {
    const evaluation = await this.evaluations.findById(id);
    if (!evaluation) throw new NotFoundException(`Không tìm thấy hồ sơ đánh giá: ${id}`);
    return { evaluation, period: await this.requirePeriod(evaluation.periodId) };
  }

  private async requirePeriod(id: string): Promise<PeriodModel> {
    const period = await this.periods.findById(id);
    if (!period) throw new NotFoundException(`Không tìm thấy kỳ đánh giá: ${id}`);
    return period;
  }

  private async requireTask(id: string): Promise<TaskModel> {
    const task = await this.tasks.findById(id);
    if (!task) throw new NotFoundException(`Không tìm thấy dòng chỉ tiêu: ${id}`);
    return task;
  }

  private async requireVersion(period: PeriodModel): Promise<CatalogVersionInfo> {
    const version = await this.catalog.getVersion(period.catalogVersionId);
    if (!version) throw new NotFoundException(`Không tìm thấy phiên bản danh mục của kỳ ${period.label}`);
    return version;
  }
}

function toScored(tasks: readonly TaskModel[], version: CatalogVersionInfo): ScoredTask[] {
  return tasks.map((t) => ({
    coefficient: version.items.get(t.catalogItemCode)?.coefficient ?? 0,
    plannedQuantity: t.plannedQuantity,
    completedQuantity: t.completedQuantity,
    qualityLevel: t.qualityLevel,
    lateCount: t.lateCount,
    reworkCount: t.reworkCount,
  }));
}

function assertQuantity(value: number, min: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > MAX_QUANTITY) {
    throw new BadRequestException(`${label} phải là số nguyên từ ${min} đến ${MAX_QUANTITY}`);
  }
}

function assertGeneralScore(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_GENERAL_SCORE) {
    throw new BadRequestException(`Điểm tiêu chí chung phải từ 0 đến ${MAX_GENERAL_SCORE}`);
  }
}

/** Bộ cộng dồn cho một dòng chỉ tiêu khi gộp nhiều việc cùng mã công việc. */
function newLine() {
  return { planned: 0, completed: 0, late: 0, rework: 0, evidence: [] as string[], sources: [] as string[], titles: [] as string[] };
}
