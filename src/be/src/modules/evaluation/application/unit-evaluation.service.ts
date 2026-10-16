import { isAdHocCode } from '../../../common/ad-hoc.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import { AuditService } from '../../security/index.js';
import { classifyByScore, totalScore } from '../../scoring/index.js';
import type { Rating } from '../../scoring/index.js';
import type { PeriodModel } from './evaluation.model.js';
import { OrgDirectory, PeriodRepository, PeriodWorkSource } from './evaluation.ports.js';
import type { Actor } from './evaluation.service.js';
import type { UnitEvaluationModel, UnitInfo, UnitMetrics } from './unit-evaluation.model.js';
import { UnitAxisRepository, UnitDirectory, UnitEvaluationRepository } from './unit-evaluation.ports.js';
import { COMPLAINT_WARNING_MARK, complaintWarning, UnitComplaintRepository } from './unit-complaint.js';
import { resolveScores, suggestedScores, validateAxisConfig } from './unit-axes.js';
import type { AxisDefinition, AxisInput } from './unit-axes.js';
import { computeMetrics, quotaWarning, ratingWarnings } from './unit-evaluation.rules.js';
import { deadlineStatus, deadlineWarning } from './rating-deadline.js';
import type { DeadlineStatus } from './rating-deadline.js';

/** Quyền theo vai trò của người gọi, do lớp trình bày tra cứu. */
export interface UnitAccess {
  /** Có `evaluation:read-all`. */
  readAll: boolean;
  /** Có `evaluation:decide-ban`: thẩm định, phê duyệt hồ sơ của Ban (ADR-030 mục 5). */
  decideBan: boolean;
}

export interface UnitEvaluationView {
  evaluation: UnitEvaluationModel;
  period: PeriodModel;
  unit: { id: string; code: string; name: string; type: 'BAN' | 'PHONG' };
  headPersonId: string | null;
  /** Số liệu đã chụp khi thẩm định; trước đó là số liệu tính tại thời điểm xem. */
  metrics: UnitMetrics;
  /** Mức xếp loại đã chốt, hoặc mức suy ra từ điểm tự chấm khi chưa thẩm định. */
  proposedRating: Rating | null;
  /** Điều kiện xếp loại chưa đạt, hạn mức xuất sắc: chỉ cảnh báo (ADR-030 mục 7). */
  warnings: string[];
  /** Các trục đang bật khi chấm điểm (ADR-036); rỗng là nhập một số cho cả hai nhóm. */
  axes: AxisDefinition[];
  /** Điểm gợi ý theo số liệu tham chiếu cho trục có cách gợi ý, theo mã trục. */
  suggested: Record<string, number>;
  /** Hạn hoàn thành đánh giá năm (ADR-038). */
  deadline: DeadlineStatus | null;
  /** Số khiếu nại, phản ánh chưa kết luận; chặn công nhận (ADR-038). Người đứng đầu và thành viên đơn vị luôn thấy 0. */
  openComplaints: number;
}

export interface GenerateUnitsResult {
  created: number;
  existing: number;
}

export interface UnitScoreInput {
  /** Nhập một số khi nhóm tiêu chí chung không có trục nào đang bật (ADR-036). */
  generalScore?: number;
  /** Nhập một số khi nhóm kết quả không có trục nào đang bật. */
  resultScore?: number;
  /** Điểm từng trục đang bật; điểm nhóm là tổng các trục (ADR-036). */
  axes?: AxisInput[];
  comment?: string | null;
}

interface Authority {
  /** Cán bộ đứng trên người đứng đầu đơn vị, từ gần đến xa, đã bỏ vị trí trống. */
  holders: string[];
  reviewer: string | null;
  approver: string | null;
}

/**
 * Đánh giá, xếp loại tập thể theo năm (ADR-030). Cùng luồng với hồ sơ cá nhân: người đứng đầu tự chấm,
 * cấp trên thẩm định, cấp trên của người thẩm định phê duyệt. Riêng hồ sơ của Ban do tài khoản đại diện
 * Ban Thường vụ thẩm định và phê duyệt vì không có cấp trên trong cơ cấu của Ban.
 */
@Injectable()
export class UnitEvaluationService {
  constructor(
    private readonly periods: PeriodRepository,
    private readonly evaluations: UnitEvaluationRepository,
    private readonly directory: UnitDirectory,
    private readonly org: OrgDirectory,
    private readonly work: PeriodWorkSource,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
    private readonly axisConfig: UnitAxisRepository,
    private readonly complaints: UnitComplaintRepository,
  ) {}

  /** Các trục chấm điểm hiện có, kể cả trục đã tắt (ADR-036). */
  axes(): Promise<AxisDefinition[]> {
    return this.axisConfig.findAll();
  }

  /**
   * Thay cấu hình trục. Tổng điểm tối đa mỗi nhóm đang bật phải đúng 30 hoặc 70; không sửa khi còn hồ sơ tập thể đang
   * chờ thẩm định hoặc phê duyệt trong kỳ đang mở để cùng một kỳ chấm theo cùng bộ trục (ADR-036 mục 6).
   */
  async replaceAxes(actor: Actor, axes: readonly AxisDefinition[]): Promise<AxisDefinition[]> {
    const errors = validateAxisConfig(axes);
    if (errors.length > 0) throw new BadRequestException(errors.join('; '));
    for (const period of (await this.periods.findAll()).filter((p) => p.type === 'YEAR' && p.status === 'OPEN')) {
      const inFlight = (await this.evaluations.findByPeriod(period.id)).filter((e) => e.status === 'SELF_SUBMITTED' || e.status === 'REVIEWED');
      if (inFlight.length > 0) {
        throw new ConflictException(`Kỳ ${period.label} còn ${inFlight.length} hồ sơ tập thể đang chờ thẩm định hoặc phê duyệt; hãy hoàn tất hoặc trả lại trước khi đổi trục chấm điểm`);
      }
    }
    const before = await this.axisConfig.findAll();
    const sorted = [...axes].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    await this.axisConfig.replaceAll(sorted);
    await this.audit.record({
      action: 'unit-evaluation.axes.update',
      outcome: 'SUCCESS',
      targetType: 'unit_axis',
      details: { before: before.map((a) => ({ code: a.code, max: a.maxPoints, active: a.active })), after: sorted.map((a) => ({ code: a.code, max: a.maxPoints, active: a.active })) },
    });
    return sorted;
  }

  /** Tạo hồ sơ cho mọi đơn vị trong kỳ năm; đơn vị đã có hồ sơ được giữ nguyên. */
  async generate(actor: Actor, periodId: string): Promise<GenerateUnitsResult> {
    const period = await this.requireYearPeriod(periodId);
    this.assertOpen(period);
    const existing = new Set((await this.evaluations.findByPeriod(periodId)).map((e) => e.unitId));
    let created = 0;
    for (const unit of await this.directory.units()) {
      if (existing.has(unit.id)) continue;
      await this.evaluations.create({ periodId, unitId: unit.id, createdBy: actor.id });
      created++;
    }
    await this.audit.record({
      action: 'unit-evaluation.generate',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: period.label, created, existing: existing.size },
    });
    return { created, existing: existing.size };
  }

  async list(actor: Actor, periodId: string, access: UnitAccess): Promise<UnitEvaluationView[]> {
    const period = await this.requireYearPeriod(periodId);
    const [rows, units] = await Promise.all([this.evaluations.findByPeriod(periodId), this.directory.units()]);
    const unitById = new Map(units.map((u) => [u.id, u]));
    const ctx = await this.context(period, rows, units);
    const out: UnitEvaluationView[] = [];
    for (const row of rows) {
      const unit = unitById.get(row.unitId);
      if (!unit) continue;
      const level = await this.viewLevel(actor, unit, row, access);
      if (level === null) continue;
      out.push(this.forViewer(this.view(row, period, unit, ctx), level, actor, unit));
    }
    return out.sort((a, b) => Number(b.unit.type === 'BAN') - Number(a.unit.type === 'BAN') || a.unit.code.localeCompare(b.unit.code));
  }

  async get(actor: Actor, id: string, access: UnitAccess): Promise<UnitEvaluationView> {
    const { evaluation, period, unit } = await this.load(id);
    const level = await this.viewLevel(actor, unit, evaluation, access);
    if (level === null) throw new NotFoundException(`Không tìm thấy hồ sơ đánh giá tập thể: ${id}`);
    const [rows, units] = await Promise.all([this.evaluations.findByPeriod(period.id), this.directory.units()]);
    return this.forViewer(this.view(evaluation, period, unit, await this.context(period, rows, units)), level, actor, unit);
  }

  /**
   * Bản trả về theo người xem: thành viên chỉ thấy kết quả; người đứng đầu đơn vị không thấy khiếu nại về đơn vị mình
   * (ADR-038 mục 6), nên số khiếu nại và câu cảnh báo tương ứng được bỏ.
   */
  private forViewer(view: UnitEvaluationView, level: 'FULL' | 'RESULT', actor: Actor, unit: UnitInfo): UnitEvaluationView {
    if (level === 'RESULT') return redact(view);
    if (actor.personId && actor.personId === unit.headPersonId) {
      return { ...view, openComplaints: 0, warnings: view.warnings.filter((w) => !w.includes(COMPLAINT_WARNING_MARK)) };
    }
    return view;
  }

  /** Vai trò của người gọi với một hồ sơ, không ném lỗi: dùng cho khiếu nại (ADR-038). */
  async authorityOn(actor: Actor, id: string, access: UnitAccess) {
    const { evaluation, period, unit } = await this.load(id);
    let isApprover: boolean;
    let isReviewer: boolean;
    let approverPersonId: string | null = null;
    if (unit.parentId === null) {
      // Hồ sơ của Ban: đại diện Ban Thường vụ; người đứng đầu Ban không tự quyết hồ sơ của mình.
      isApprover = isReviewer = access.decideBan && !(actor.personId && actor.personId === unit.headPersonId);
    } else {
      const authority = await this.authority(unit);
      approverPersonId = authority.approver;
      isApprover = !!actor.personId && actor.personId === authority.approver;
      isReviewer = !!actor.personId && actor.personId === authority.reviewer;
    }
    return { evaluation, period, unit, isApprover, isReviewer, approverPersonId };
  }

  /** Mã hồ sơ tập thể của đơn vị trong kỳ, hoặc null nếu chưa tạo. */
  async evaluationIdOf(periodId: string, unitId: string): Promise<string | null> {
    return (await this.evaluations.findByPeriodAndUnit(periodId, unitId))?.id ?? null;
  }

  /** Người đứng đầu tự đánh giá và đề xuất điểm. */
  async selfSubmit(actor: Actor, id: string, input: UnitScoreInput): Promise<UnitEvaluationModel> {
    const { evaluation, period, unit } = await this.load(id);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['PLANNED']);
    this.assertHead(actor, unit);
    const scores = resolveScores(await this.axisConfig.findAll(), input);

    const updated = await this.evaluations.update(id, {
      status: 'SELF_SUBMITTED',
      selfGeneralScore: scores.generalScore,
      selfResultScore: scores.resultScore,
      selfAxisScores: scores.axes,
      selfComment: input.comment?.trim() || null,
      selfSubmittedAt: this.clock.now(),
      returnReason: null,
    });
    await this.audit.record({
      action: 'unit-evaluation.self-submit',
      outcome: 'SUCCESS',
      targetType: 'unit_evaluation',
      targetId: id,
      details: { period: period.label, unit: unit.code, generalScore: scores.generalScore, resultScore: scores.resultScore, axes: scores.axes },
    });
    await this.notifyNext(unit, (await this.authority(unit)).reviewer, `Có hồ sơ đánh giá tập thể ${unit.name} năm ${period.label} chờ bạn thẩm định`, id, 'EVAL_SELF_SUBMITTED');
    return updated;
  }

  /** Thẩm định: chấm điểm, chụp số liệu tham chiếu, đề xuất xếp loại. Cấp dưới phải được phê duyệt trước. */
  async review(actor: Actor, id: string, input: UnitScoreInput, access: UnitAccess): Promise<UnitEvaluationView> {
    const { evaluation, period, unit } = await this.load(id);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['SELF_SUBMITTED']);
    await this.assertAuthority(actor, unit, 'reviewer', access, 'thẩm định hồ sơ của');
    const scores = resolveScores(await this.axisConfig.findAll(), input);

    const [rows, units] = await Promise.all([this.evaluations.findByPeriod(period.id), this.directory.units()]);
    const pending = units
      .filter((u) => u.parentId === unit.id)
      .filter((child) => rows.find((r) => r.unitId === child.id)?.status !== 'APPROVED')
      .map((u) => u.name);
    if (pending.length > 0) {
      throw new ConflictException(`Phải đánh giá đơn vị cấp dưới trước cấp trên (Nghị định 335 Điều 9.1). Chưa phê duyệt: ${pending.join(', ')}`);
    }

    const ctx = await this.context(period, rows, units);
    const metrics = ctx.metricsOf(unit);
    const total = totalScore(scores.generalScore, scores.resultScore);
    const rating = classifyByScore(total);

    const updated = await this.evaluations.update(id, {
      status: 'REVIEWED',
      generalScore: scores.generalScore,
      resultScore: scores.resultScore,
      axisScores: scores.axes,
      totalScore: total,
      rating,
      metrics,
      reviewComment: input.comment?.trim() || null,
      reviewerAccountId: actor.id,
      reviewedAt: this.clock.now(),
      returnReason: null,
    });
    await this.audit.record({
      action: 'unit-evaluation.review',
      outcome: 'SUCCESS',
      targetType: 'unit_evaluation',
      targetId: id,
      details: { period: period.label, unit: unit.code, generalScore: scores.generalScore, resultScore: scores.resultScore, axes: scores.axes, totalScore: total, rating, metrics },
    });
    await this.notifyNext(unit, (await this.authority(unit)).approver, `Có hồ sơ đánh giá tập thể ${unit.name} năm ${period.label} chờ bạn phê duyệt`, id, 'EVAL_REVIEWED');
    return this.view(updated, period, unit, await this.context(period, await this.evaluations.findByPeriod(period.id), units));
  }

  /** Công nhận kết quả. Từ đây hồ sơ khóa. */
  async approve(actor: Actor, id: string, comment: string | null | undefined, access: UnitAccess): Promise<UnitEvaluationView> {
    const { evaluation, period, unit } = await this.load(id);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['REVIEWED']);
    await this.assertAuthority(actor, unit, 'approver', access, 'phê duyệt hồ sơ của');
    // Điều 9.2.a: có đơn thư, phản ánh thì phải kiểm tra, xác minh trước khi quyết định xếp loại.
    const open = (await this.complaints.openCounts(period.id)).get(unit.id) ?? 0;
    if (open > 0) throw new ConflictException(`Còn ${open} khiếu nại, phản ánh về ${unit.name} chưa kiểm tra, xác minh xong; chưa công nhận được xếp loại (Nghị định 335 Điều 9.2.a)`);

    const updated = await this.evaluations.update(id, {
      status: 'APPROVED',
      approverAccountId: actor.id,
      approvedAt: this.clock.now(),
      approveComment: comment?.trim() || null,
    });
    await this.audit.record({
      action: 'unit-evaluation.approve',
      outcome: 'SUCCESS',
      targetType: 'unit_evaluation',
      targetId: id,
      details: { period: period.label, unit: unit.code, totalScore: updated.totalScore, rating: updated.rating },
    });
    // Kết quả được thông báo đến tổ chức được đánh giá (Điều 9.2.b): người đứng đầu và mọi cán bộ của đơn vị.
    await this.notifier.notify([...new Set([unit.headPersonId, ...unit.memberPersonIds])], {
      type: 'EVAL_APPROVED',
      title: `Kết quả đánh giá tập thể ${unit.name} năm ${period.label} đã được công nhận`,
      link: `/unit-evaluations/${id}`,
    });
    const [rows, units] = await Promise.all([this.evaluations.findByPeriod(period.id), this.directory.units()]);
    return this.view(updated, period, unit, await this.context(period, rows, units));
  }

  /** Trả hồ sơ về cho người đứng đầu: người thẩm định trả hồ sơ đã tự chấm, người phê duyệt trả hồ sơ đã thẩm định. */
  async returnEvaluation(actor: Actor, id: string, reason: string, access: UnitAccess): Promise<UnitEvaluationModel> {
    const { evaluation, period, unit } = await this.load(id);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['SELF_SUBMITTED', 'REVIEWED']);
    if (reason.trim().length < 3) throw new BadRequestException('Cần nêu lý do trả lại');
    const from = evaluation.status;
    await this.assertAuthority(actor, unit, from === 'SELF_SUBMITTED' ? 'reviewer' : 'approver', access, 'trả lại hồ sơ của');

    const updated = await this.evaluations.update(id, {
      status: 'PLANNED',
      generalScore: null,
      resultScore: null,
      axisScores: null,
      totalScore: null,
      rating: null,
      metrics: null,
      reviewComment: null,
      reviewerAccountId: null,
      reviewedAt: null,
      returnReason: reason.trim(),
    });
    await this.audit.record({
      action: 'unit-evaluation.return',
      outcome: 'SUCCESS',
      targetType: 'unit_evaluation',
      targetId: id,
      details: { period: period.label, unit: unit.code, from, reason: reason.trim() },
    });
    await this.notifier.notify([unit.headPersonId], {
      type: 'EVAL_RETURNED',
      title: `Hồ sơ đánh giá tập thể ${unit.name} năm ${period.label} bị trả lại, cần chỉnh sửa`,
      link: `/unit-evaluations/${id}`,
    });
    return updated;
  }

  /** Nhắc người đang giữ hồ sơ tập thể chưa xong: người đứng đầu chưa tự chấm, người thẩm định, người phê duyệt (ADR-038). */
  async remindDeadline(actor: Actor, periodId: string): Promise<{ notified: number }> {
    const period = await this.requireYearPeriod(periodId);
    const status = deadlineStatus(period, this.clock.now())!;
    const dmy = status.date.split('-').reverse().join('/');
    const units = new Map((await this.directory.units()).map((u) => [u.id, u]));
    const recipients = new Set<string>();
    for (const e of await this.evaluations.findByPeriod(periodId)) {
      if (e.status === 'APPROVED') continue;
      const unit = units.get(e.unitId);
      // Hồ sơ của Ban do tài khoản đại diện Ban Thường vụ xử lý, không gắn với cán bộ nên không có người nhận thông báo.
      if (!unit || unit.parentId === null) continue;
      const authority = await this.authority(unit);
      const holder = e.status === 'PLANNED' ? unit.headPersonId : e.status === 'SELF_SUBMITTED' ? authority.reviewer : authority.approver;
      if (holder) recipients.add(holder);
    }
    await this.notifier.notify([...recipients], {
      type: 'DEADLINE_REMINDER',
      title: `Nhắc hoàn thành đánh giá, xếp loại tập thể năm ${period.label} trước ngày ${dmy}`,
      link: `/unit-evaluations?period=${periodId}`,
    });
    await this.audit.record({ action: 'unit-evaluation.remind', outcome: 'SUCCESS', targetType: 'evaluation_period', targetId: periodId, details: { label: period.label, notified: recipients.size } });
    return { notified: recipients.size };
  }

  // ------------------------------------------------------------------ nội bộ

  /** Người thẩm định là người đầu tiên giữ vị trí cấp trên của người đứng đầu; người phê duyệt là người kế tiếp. */
  private async authority(unit: UnitInfo): Promise<Authority> {
    if (!unit.headPersonId || unit.parentId === null) return { holders: [], reviewer: null, approver: null };
    const holders = (await this.org.superiorsOf(unit.headPersonId)).flatMap((s) => (s.personId ? [s.personId] : []));
    return { holders, reviewer: holders[0] ?? null, approver: holders[1] ?? holders[0] ?? null };
  }

  /**
   * FULL: xem đủ (số liệu, nhận xét, cảnh báo). RESULT: thành viên của đơn vị chỉ xem kết quả sau khi đã phê duyệt
   * (Nghị định 335 Điều 9.2.b: kết quả được thông báo đến tổ chức được đánh giá). null: không xem được.
   */
  private async viewLevel(actor: Actor, unit: UnitInfo, evaluation: UnitEvaluationModel, access: UnitAccess): Promise<'FULL' | 'RESULT' | null> {
    if (access.readAll) return 'FULL';
    if (unit.parentId === null && access.decideBan) return 'FULL';
    if (!actor.personId) return null;
    if (actor.personId === unit.headPersonId) return 'FULL';
    if ((await this.authority(unit)).holders.includes(actor.personId)) return 'FULL';
    if (evaluation.status === 'APPROVED' && unit.memberPersonIds.includes(actor.personId)) return 'RESULT';
    return null;
  }

  private assertHead(actor: Actor, unit: UnitInfo): void {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác đánh giá được');
    if (!unit.headPersonId) throw new ConflictException(`${unit.name} chưa có người đứng đầu`);
    if (actor.personId !== unit.headPersonId) throw new ForbiddenException('Chỉ người đứng đầu đơn vị được tự đánh giá cho đơn vị mình');
  }

  private async assertAuthority(actor: Actor, unit: UnitInfo, role: 'reviewer' | 'approver', access: UnitAccess, verb: string): Promise<void> {
    if (unit.parentId === null) {
      // Hồ sơ của Ban: tài khoản đại diện Ban Thường vụ; người đứng đầu Ban không tự thẩm định hay phê duyệt cho mình.
      if (!access.decideBan) throw new ForbiddenException(`Chỉ đại diện Ban Thường vụ được ${verb} Ban`);
      if (actor.personId && actor.personId === unit.headPersonId) throw new ForbiddenException('Người đứng đầu không tự thẩm định hay phê duyệt hồ sơ của đơn vị mình');
      return;
    }
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác đánh giá được');
    const expected = (await this.authority(unit))[role];
    if (expected === null) throw new ConflictException('Chưa có người giữ vị trí cấp trên để thực hiện bước này');
    if (actor.personId !== expected) throw new ForbiddenException(`Bạn không phải người có thẩm quyền ${verb} đơn vị này`);
  }

  private assertStatus(evaluation: UnitEvaluationModel, allowed: UnitEvaluationModel['status'][]): void {
    if (!allowed.includes(evaluation.status)) {
      throw new ConflictException(`Hồ sơ đang ở trạng thái ${evaluation.status}, không thực hiện được thao tác này`);
    }
  }

  private assertOpen(period: PeriodModel): void {
    if (period.status !== 'OPEN') throw new ConflictException(`Kỳ ${period.label} đã đóng`);
  }

  private async notifyNext(unit: UnitInfo, personId: string | null, title: string, id: string, type: 'EVAL_SELF_SUBMITTED' | 'EVAL_REVIEWED'): Promise<void> {
    // Hồ sơ của Ban chuyển cho tài khoản đại diện Ban Thường vụ, không gắn với cán bộ nên không có người nhận thông báo.
    if (unit.parentId === null) return;
    await this.notifier.notify([personId], { type, title, link: `/unit-evaluations/${id}` });
  }

  /** Số liệu và xếp loại các đơn vị khác trong kỳ, tính một lần cho cả danh sách. */
  private async context(period: PeriodModel, rows: UnitEvaluationModel[], units: UnitInfo[]) {
    // Việc đột xuất tính ngoài số nhiệm vụ giao ban đầu (Điều 18.1.d), nên không vào số liệu tham chiếu của tập thể.
    const works = (await this.work.collect(period)).filter((w) => !isAdHocCode(w.catalogItemCode));
    const axes = await this.axisConfig.findAll();
    const openComplaints = await this.complaints.openCounts(period.id);
    const unitByPerson = new Map<string, string>();
    for (const u of units) for (const p of u.memberPersonIds) unitByPerson.set(p, u.id);

    const descendants = (unitId: string): Set<string> => {
      const ids = new Set([unitId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const u of units) {
          if (u.parentId && ids.has(u.parentId) && !ids.has(u.id)) {
            ids.add(u.id);
            grew = true;
          }
        }
      }
      return ids;
    };
    const metricsOf = (unit: UnitInfo): UnitMetrics => {
      const scope = descendants(unit.id);
      return computeMetrics(works.filter((w) => scope.has(unitByPerson.get(w.personId) ?? '')));
    };
    const ratingOf = (unitId: string): Rating | null => rows.find((r) => r.unitId === unitId)?.rating ?? null;
    // Hạn mức tính trong phạm vi cấp công nhận (Điều 8.5.a): phòng do Trưởng ban công nhận, Ban do Ban Thường vụ.
    // Cộng thêm mức đang đề xuất của đơn vị đang xem, vì hồ sơ chưa thẩm định thì chưa có xếp loại chính thức.
    const isBan = new Map(units.map((u) => [u.id, u.parentId === null]));
    const decidedWith = (unit: UnitInfo, proposed: Rating): Rating[] => [
      ...rows.flatMap((r) => (r.rating && r.unitId !== unit.id && isBan.get(r.unitId) === (unit.parentId === null) ? [r.rating] : [])),
      proposed,
    ];
    return { metricsOf, ratingOf, decidedWith, units, axes, openComplaints };
  }

  private view(
    evaluation: UnitEvaluationModel,
    period: PeriodModel,
    unit: UnitInfo,
    ctx: Awaited<ReturnType<UnitEvaluationService['context']>>,
  ): UnitEvaluationView {
    const metrics = evaluation.metrics ?? ctx.metricsOf(unit);
    const selfTotal =
      evaluation.selfGeneralScore !== null && evaluation.selfResultScore !== null
        ? classifyByScore(evaluation.selfGeneralScore + evaluation.selfResultScore)
        : null;
    const proposedRating = evaluation.rating ?? selfTotal;
    const warnings: string[] = [];
    if (proposedRating) {
      const failedChildren = ctx.units.filter((u) => u.parentId === unit.id && ctx.ratingOf(u.id) === 'KHONG_HOAN_THANH').map((u) => u.name);
      warnings.push(...ratingWarnings(proposedRating, metrics, failedChildren));
      if (proposedRating === 'XUAT_SAC') {
        const quota = quotaWarning(ctx.decidedWith(unit, proposedRating));
        if (quota) warnings.push(quota);
      }
    }
    const openComplaints = ctx.openComplaints.get(unit.id) ?? 0;
    if (openComplaints > 0 && evaluation.status !== 'APPROVED') warnings.push(complaintWarning(openComplaints));
    const deadline = deadlineStatus(period, this.clock.now());
    if (evaluation.status !== 'APPROVED') {
      const due = deadlineWarning(deadline);
      if (due) warnings.push(due);
    }
    const active = ctx.axes.filter((a) => a.active).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    return {
      evaluation,
      period,
      unit: { id: unit.id, code: unit.code, name: unit.name, type: unit.type },
      headPersonId: unit.headPersonId,
      metrics,
      proposedRating,
      warnings,
      axes: active,
      suggested: suggestedScores(active, metrics),
      deadline,
      openComplaints,
    };
  }

  private async load(id: string): Promise<{ evaluation: UnitEvaluationModel; period: PeriodModel; unit: UnitInfo }> {
    const evaluation = await this.evaluations.findById(id);
    if (!evaluation) throw new NotFoundException(`Không tìm thấy hồ sơ đánh giá tập thể: ${id}`);
    const period = await this.requireYearPeriod(evaluation.periodId);
    const unit = (await this.directory.units()).find((u) => u.id === evaluation.unitId);
    if (!unit) throw new NotFoundException(`Không tìm thấy đơn vị: ${evaluation.unitId}`);
    return { evaluation, period, unit };
  }

  private async requireYearPeriod(id: string): Promise<PeriodModel> {
    const period = await this.periods.findById(id);
    if (!period) throw new NotFoundException(`Không tìm thấy kỳ đánh giá: ${id}`);
    if (period.type !== 'YEAR') throw new BadRequestException('Chỉ xếp loại tập thể theo năm (Nghị định 335 Điều 9.1)');
    return period;
  }
}

/** Bản cho thành viên đơn vị: chỉ điểm và xếp loại, không có nhận xét, lý do trả lại hay cảnh báo nội bộ. */
function redact(view: UnitEvaluationView): UnitEvaluationView {
  const e = view.evaluation;
  return {
    ...view,
    evaluation: { ...e, selfComment: null, reviewComment: null, approveComment: null, returnReason: null, selfAxisScores: null },
    warnings: [],
    suggested: {},
  };
}
