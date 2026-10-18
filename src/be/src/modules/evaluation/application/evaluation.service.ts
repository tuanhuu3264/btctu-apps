import { adHocCoefficient, isAdHocCode } from '../../../common/ad-hoc.js';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import { isInScope } from '../../../common/scope.js';
import { AuditService } from '../../security/index.js';
import { classifyByScore, MAX_GENERAL_SCORE, totalScore } from '../../scoring/index.js';
import { checkSupportScores, SUPPORT_POLICY, supportRate, supportResultScore } from './support-criteria.js';
import type { SupportScores } from './support-criteria.js';
import { checkMarks, effectiveVersion, GENERAL_GROUP_LABELS, GeneralCriteriaRepository, scoreOf, setOf } from './general-criteria.js';
import type { GeneralCriteriaSet, GeneralCriteriaVersion, GeneralGroup, GeneralMark, GeneralMarks } from './general-criteria.js';
import { MAX_QUANTITY, QUALITY_LEVELS, REVOCATION_REASONS } from './evaluation.model.js';
import { excellentQuota, quotaGroupKey, quotaMessage } from './excellent-quota.js';
import type { ExcellentQuota, QuotaRanked, QuotaRow } from './excellent-quota.js';
import type {
  EvaluationModel,
  PeriodModel,
  PeriodType,
  RevocationModel,
  RevocationReason,
  TaskModel,
  TaskPatch,
} from './evaluation.model.js';
import { CatalogDirectory, EvaluationRepository, HeadedUnitRatingSource, OrgDirectory, PeriodRepository, PeriodWorkSource, TaskRepository, UnitCompletionSource } from './evaluation.ports.js';
import { CONDITION_EXCEPTIONS, describeEvent, forcedItems, RatingEventRepository, yearConditions } from './rating-events.js';
import type { ConditionException, RatingEventModel, YearCondition, YearFigures } from './rating-events.js';
import type { PositionInfo } from './evaluation.ports.js';
import type { CatalogVersionInfo, PeriodWork } from './evaluation.ports.js';
import { buildPeriod } from './period.js';
import { LEAVE_REASONS, LeaveRepository } from './leave.js';
import { UnitComplaintRepository } from './unit-complaint.js';
import type { LeaveMonth } from './leave.js';
import { deadlineStatus, deadlineWarning, todayVn, validateDeadline } from './rating-deadline.js';
import type { DeadlineStatus } from './rating-deadline.js';
import { headRatingWarning } from './unit-evaluation.rules.js';
import { averageYear, MIN_MONTHS_FOR_YEAR } from './year-average.js';
import type { MonthScore, YearAverage } from './year-average.js';
import { DEFAULT_SCORING_PARAMS, evaluate, LEADERSHIP_LEVELS } from './scoring-policy.js';
import { explainScore, simulate, suggest } from './score-insight.js';
import type { InsightTask, ScoreExplanation, Simulation, Suggestions, TaskOverride } from './score-insight.js';
import type { Evaluated, KpiBreakdown, Leadership, ScoredTask } from './scoring-policy.js';

/** Người thao tác: tài khoản đang đăng nhập và cán bộ gắn với tài khoản đó (có thể chưa gắn). */
/** Kỳ đánh giá kèm hạn hoàn thành của kỳ năm (ADR-038). */
export type PeriodView = PeriodModel & { deadline: DeadlineStatus | null };

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
  /** Vị trí hỗ trợ, phục vụ: kết quả chấm theo ba tiêu chí a, b, c thay cho chỉ tiêu (ADR-053). */
  isSupport: boolean;
  /** Gợi ý cho tiêu chí D "kết quả hoạt động của đơn vị" từ xếp loại của cấp dưới trong cùng kỳ (null nếu chưa có dữ liệu). */
  /** Gợi ý ba tiêu chí D từ số liệu trong hệ thống; người thẩm định quyết định (ADR-040). */
  leadershipSuggestion: { unitResult: number | null; solidarity: number | null; solidarityReason: string | null } | null;
  /** Kỳ năm: điểm các tháng đã phê duyệt và trung bình (ADR-035); null với kỳ khác. */
  yearAverage: YearAverage | null;
  /** Cảnh báo theo quy định chưa được hệ thống tự áp dụng. */
  warnings: string[];
  /** Người thẩm định và phê duyệt hiện tại theo cây tổ chức (null nếu không có). */
  reviewerPersonId: string | null;
  approverPersonId: string | null;
  /** Bảng tiêu chí chung chấm theo mục con của hồ sơ (ADR-054); null với kỳ năm và kỳ chưa có bảng áp dụng (chấm một ô 0–30). */
  generalCriteria: (GeneralCriteriaSet & { versionId: string; effectiveFrom: string; note: string | null; group: GeneralGroup; groupLabel: string }) | null;
  /** Hạn chế người thẩm định đã nêu ở kỳ cùng loại liền trước, để đối chiếu các mục khắc phục khuyết điểm. */
  previous: { periodLabel: string; reviewComment: string | null; limitations: { code: string; name: string; note: string | null }[] } | null;
  /** Kỷ luật, kết luận... có hiệu lực trong kỳ (kỳ năm: cả năm) (ADR-055). */
  ratingEvents: RatingEventModel[];
  /** Mục tiêu chí chung bắt buộc Không đảm bảo trong kỳ do các sự kiện trên. */
  forcedItems: { code: string; reasons: string[] }[];
  /** Kỳ năm: điều kiện xếp loại "Không hoàn thành nhiệm vụ" (39-QĐ/TU Điều 11 mục 4); đã thẩm định thì là điều kiện lúc thẩm định. */
  yearConditions: YearCondition[];
  /** Các lần hủy kết quả đã phê duyệt để xếp loại lại (ADR-059), mới nhất trước. */
  revocations: RevocationModel[];
  /** Hạn mức xuất sắc của nhóm khi hồ sơ này ở mức xuất sắc (ADR-060); null nếu hồ sơ không ở mức xuất sắc. Chỉ gợi ý. */
  excellentQuota: (ExcellentQuota & { mine: QuotaRanked | null }) | null;
}

/** Hạn mức xuất sắc của một nhóm trong kỳ, cho người phê duyệt và Văn phòng (ADR-060). */
export interface PeriodQuotaGroup {
  unitId: string | null;
  kind: 'LEADER' | 'SUPPORT' | 'STAFF';
  quota: ExcellentQuota;
}

/** Kết quả chấm một mục tiêu chí chung gửi lên (ADR-054). */
export interface GeneralMarkInput {
  code: string;
  ok: boolean;
  note?: string | null;
}

/** Giải thích điểm và gợi ý của một hồ sơ (chỉ đọc, không ghi gì). */
export interface InsightView {
  /** false với kỳ năm: điểm năm là trung bình các tháng nên không giải thích theo dòng việc. */
  supported: boolean;
  reason?: string;
  /** Hồ sơ đã chốt (đã thẩm định hoặc phê duyệt): mô phỏng chỉ để tham khảo. */
  frozen: boolean;
  explanation: ScoreExplanation | null;
  suggestions: Suggestions | null;
  /** Các dòng để dựng bộ mô phỏng ở giao diện. */
  tasks: { taskId: string; code: string; name: string; planned: number; completed: number; lateCount: number; reworkCount: number; qualityLevel: number | null; extra: boolean }[];
  generalScore: number | null;
  isLeader: boolean;
}

export interface SimulateInput {
  tasks?: TaskOverride[];
  /** Điểm tiêu chí chung giả định (0 đến 30); bỏ trống thì giữ hiện tại. */
  generalScore?: number | null;
}

export interface GenerateResult {
  period: string;
  /** Số hồ sơ mới tạo và số hồ sơ đã có được làm mới. */
  created: number;
  refreshed: number;
  /** Cán bộ không điền được kèm lý do (không giữ vị trí, hồ sơ đã qua bước tự chấm...). */
  skipped: { personId: string; positionId?: string; reason: string }[];
  warnings: string[];
  evaluations: { evaluationId: string; personId: string; positionId: string; lines: number; created: boolean }[];
}

export interface ReviewInput {
  /** Kỳ tháng, quý chưa có bảng tiêu chí chung áp dụng: điểm một ô 0–30. Kỳ năm lấy trung bình các tháng nên bỏ qua (ADR-035). */
  generalScore?: number;
  /** Kỳ tháng, quý có bảng tiêu chí chung: chấm từng mục (ADR-054). */
  general?: GeneralMarkInput[];
  /** Bắt buộc với cán bộ lãnh đạo, quản lý; không được gửi với người khác. */
  leadership?: Leadership;
  /** Bắt buộc với vị trí hỗ trợ, phục vụ; không được gửi với người khác (ADR-053). */
  support?: SupportScores;
  comment?: string | null;
  tasks?: { taskId: string; qualityLevel?: number; completedQuantity?: number }[];
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
    private readonly unitRatings: HeadedUnitRatingSource,
    private readonly leave: LeaveRepository,
    private readonly complaints: UnitComplaintRepository,
    private readonly criteria: GeneralCriteriaRepository,
    private readonly ratingEvents: RatingEventRepository,
    private readonly completion: UnitCompletionSource,
  ) {}

  // ---------------------------------------------------------------- kỳ đánh giá

  /** Danh sách kỳ; kỳ năm kèm tình trạng hạn 15/12 (ADR-038). */
  async listPeriods(): Promise<PeriodView[]> {
    const now = this.clock.now();
    return (await this.periods.findAll()).map((p) => ({ ...p, deadline: deadlineStatus(p, now) }));
  }

  /** Văn phòng gia hạn hoặc đặt lại hạn của kỳ năm trong khoảng 15/12 đến 15/01 năm sau (ADR-038 mục 8). */
  async setDeadline(actor: Actor, periodId: string, date: string, reason?: string): Promise<PeriodView> {
    const period = await this.requirePeriod(periodId);
    if (period.type !== 'YEAR') throw new BadRequestException('Chỉ kỳ năm có hạn 15/12 (Nghị định 335 Điều 9.1)');
    validateDeadline(period.year, date, reason);
    await this.periods.setDeadline(periodId, date === `${period.year}-12-15` ? null : date);
    await this.audit.record({
      action: 'evaluation.period.deadline',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { label: period.label, from: period.ratingDeadline, to: date, reason: reason?.trim() || null },
    });
    return (await this.listPeriods()).find((p) => p.id === periodId)!;
  }

  /**
   * Nhắc những người đang giữ hồ sơ năm chưa xong (ADR-038 mục 10): cán bộ chưa tự đánh giá, người thẩm định, người phê duyệt.
   * Trả về số người nhận.
   */
  async remindDeadline(actor: Actor, periodId: string): Promise<{ notified: number }> {
    const period = await this.requirePeriod(periodId);
    if (period.type !== 'YEAR') throw new BadRequestException('Chỉ nhắc hạn cho kỳ năm');
    const status = deadlineStatus(period, this.clock.now())!;
    const dmy = status.date.split('-').reverse().join('/');
    const recipients = new Set<string>();
    for (const e of await this.evaluations.findByPeriod(periodId)) {
      if (e.status === 'APPROVED') continue;
      const authority = await this.authority(e.personId, e.positionId);
      const holder = e.status === 'PLANNED' ? e.personId : e.status === 'SELF_SUBMITTED' ? authority.reviewer : authority.approver;
      if (holder) recipients.add(holder);
    }
    await this.notifier.notify([...recipients], {
      type: 'DEADLINE_REMINDER',
      title: `Nhắc hoàn thành đánh giá, xếp loại cá nhân năm ${period.label} trước ngày ${dmy}`,
      link: `/evaluations?period=${periodId}`,
    });
    await this.audit.record({
      action: 'evaluation.period.remind',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { label: period.label, scope: 'PERSON', notified: recipients.size, today: todayVn(this.clock.now()) },
    });
    return { notified: recipients.size };
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

  /**
   * Bước 1: giao mục tiêu. Chỉ người thẩm định (cấp trên trực tiếp) của cán bộ mới tạo được hồ sơ.
   * Cán bộ kiêm nhiệm có một phiếu riêng cho mỗi vị trí (ADR-047): nêu `positionId` để chọn vị trí; không nêu thì lấy vị trí chính.
   */
  async createEvaluation(actor: Actor, periodId: string, personId: string, positionId?: string): Promise<EvaluationModel> {
    const period = await this.requirePeriod(periodId);
    this.assertOpen(period);
    const position = await this.resolvePosition(personId, period, positionId);
    const authority = await this.authority(personId, position.positionId);
    this.assertActor(actor, authority.reviewer, 'giao mục tiêu cho');
    if (await this.evaluations.findByPeriodPersonPosition(periodId, personId, position.positionId)) {
      throw new ConflictException('Cán bộ đã có hồ sơ đánh giá cho vị trí này trong kỳ này');
    }

    const created = await this.evaluations.create({ periodId, personId, positionId: position.positionId, createdBy: actor.id });
    await this.audit.record({
      action: 'evaluation.create',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: created.id,
      details: { period: period.label, personId, positionId: position.positionId },
    });
    return created;
  }

  /**
   * Vị trí mà phiếu được lập. Không nêu: vị trí chính hiện tại. Có nêu và người dùng tự chọn: phải là vị trí cán bộ giữ (chính hoặc
   * kiêm nhiệm) trong kỳ hoặc hiện nay; chỉ cần giao nhau với kỳ, không xét số ngày (đã chốt cho kiêm nhiệm). `trusted`: vị trí đã
   * được ghi lúc giao việc nên chỉ cần còn tồn tại.
   */
  private async resolvePosition(personId: string, period: PeriodModel, positionId?: string, trusted = false): Promise<PositionInfo> {
    if (!positionId) {
      const primary = await this.org.positionOf(personId);
      if (!primary) throw new ConflictException('Cán bộ hiện không giữ vị trí việc làm nào');
      return primary;
    }
    if (trusted) {
      const info = await this.org.positionInfo(positionId);
      if (!info) throw new ConflictException('Vị trí của việc đã giao không còn tồn tại');
      return info;
    }
    const now = this.clock.now();
    const held = [...(await this.org.placementsDuring(personId, periodStart(period), periodEnd(period))), ...(await this.org.placementsDuring(personId, now, now))];
    const found = held.find((p) => p.positionId === positionId);
    if (!found) throw new ConflictException('Cán bộ không giữ vị trí này trong kỳ đánh giá');
    return found;
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

    // Mỗi (cán bộ, vị trí) một phiếu. Việc không ghi vị trí (giao trước khi có kiêm nhiệm) tính vào vị trí chính; gộp nhóm
    // theo vị trí đã xác định để việc "không ghi" và việc ghi rõ vị trí chính vào cùng một phiếu.
    const groups = new Map<string, { personId: string; position: PositionInfo; items: PeriodWork[] }>();
    const result: GenerateResult = { period: period.label, created: 0, refreshed: 0, skipped: [], warnings: [], evaluations: [] };
    const unresolved = new Set<string>();
    for (const w of collected) {
      const wanted = w.positionId ?? undefined;
      const askKey = `${w.personId}|${wanted ?? ''}`;
      if (unresolved.has(askKey)) continue;
      let position: PositionInfo;
      try {
        position = await this.resolvePosition(w.personId, period, wanted, true);
      } catch (e) {
        if (!(e instanceof ConflictException)) throw e;
        unresolved.add(askKey);
        result.skipped.push({ personId: w.personId, ...(wanted ? { positionId: wanted } : {}), reason: e.message });
        continue;
      }
      const key = `${w.personId}|${position.positionId}`;
      const group = groups.get(key) ?? { personId: w.personId, position, items: [] };
      group.items.push(w);
      groups.set(key, group);
    }

    const touched = new Set<string>();
    for (const [, { personId, position, items }] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      let evaluation = await this.evaluations.findByPeriodPersonPosition(periodId, personId, position.positionId);
      if (evaluation && evaluation.status !== 'PLANNED') {
        result.skipped.push({ personId, positionId: position.positionId, reason: `Hồ sơ đang ở trạng thái ${evaluation.status}, không làm mới được` });
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
        line.waivedLate += w.waivedLateCount ?? 0;
        line.waivedRework += w.waivedReworkCount ?? 0;
        if (w.evidence) line.evidence.push(w.evidence);
        line.sources.push(w.assignmentId);
        if (w.taskTitle && !line.titles.includes(w.taskTitle)) line.titles.push(w.taskTitle);
        lines.set(w.catalogItemCode, line);
      }
      if (lines.size === 0 && !evaluation) {
        result.skipped.push({ personId, positionId: position.positionId, reason: 'Không có việc nào đủ điều kiện để điền' });
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
          waivedLateCount: line.waivedLate,
          waivedReworkCount: line.waivedRework,
        };
        const current = existing.find((t) => t.catalogItemCode === code);
        if (!current) await this.tasks.create({ evaluationId: evaluation.id, catalogItemCode: code, ...data });
        else if (current.sourceAssignmentIds.length > 0) await this.tasks.update(current.id, data);
        else result.warnings.push(`Hồ sơ của cán bộ ${personId} đã có dòng ${code} nhập tay nên không ghi đè`);
      }
      for (const t of existing) if (t.sourceAssignmentIds.length > 0 && !lines.has(t.catalogItemCode)) await this.tasks.delete(t.id);

      if (isNew) result.created += 1;
      else result.refreshed += 1;
      touched.add(evaluation.id);
      result.evaluations.push({ evaluationId: evaluation.id, personId, positionId: position.positionId, lines: lines.size, created: isNew });
    }

    // Hồ sơ còn PLANNED mà không còn việc nguồn nào (việc đã hủy): bỏ các dòng có nguồn đã lỗi thời.
    for (const evaluation of await this.evaluations.findByPeriod(periodId)) {
      if (evaluation.status !== 'PLANNED' || touched.has(evaluation.id)) continue;
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

  /** Giải thích điểm: mỗi thành phần được bao nhiêu điểm, mất ở dòng việc nào, nên làm gì để lên mức kế tiếp. */
  async getInsight(actor: Actor, id: string, canReadAll: boolean): Promise<InsightView> {
    const ctx = await this.insightContext(actor, id, canReadAll);
    if (!ctx.supported) return { supported: false, reason: ctx.reason, frozen: ctx.frozen, explanation: null, suggestions: null, tasks: [], generalScore: null, isLeader: ctx.isLeader };
    return {
      supported: true,
      frozen: ctx.frozen,
      explanation: explainScore(ctx.tasks, ctx.generalScore, ctx.leadership, ctx.isLeader),
      suggestions: suggest(ctx),
      tasks: ctx.tasks.map((t) => ({ taskId: t.id, code: t.code, name: t.name, planned: t.plannedQuantity, completed: t.completedQuantity, lateCount: t.lateCount, reworkCount: t.reworkCount, qualityLevel: t.qualityLevel, extra: !!t.extra })),
      generalScore: ctx.generalScore,
      isLeader: ctx.isLeader,
    };
  }

  /** Mô phỏng "nếu…": tính lại điểm với các giả định, không ghi vào hồ sơ. */
  async simulate(actor: Actor, id: string, canReadAll: boolean, input: SimulateInput): Promise<Simulation> {
    const ctx = await this.insightContext(actor, id, canReadAll);
    if (!ctx.supported) throw new ConflictException(ctx.reason ?? 'Hồ sơ này không mô phỏng được');
    const known = new Set(ctx.tasks.map((t) => t.id));
    const overrides = input.tasks ?? [];
    for (const o of overrides) {
      if (!known.has(o.taskId)) throw new BadRequestException(`Dòng ${o.taskId} không thuộc hồ sơ này`);
      if (o.completedQuantity !== undefined) assertQuantity(o.completedQuantity, 0, 'Số lượng hoàn thành');
      if (o.lateCount !== undefined) assertQuantity(o.lateCount, 0, 'Số lần chậm');
      if (o.reworkCount !== undefined) assertQuantity(o.reworkCount, 0, 'Số lần chưa đạt');
      if (o.qualityLevel !== undefined && o.qualityLevel !== null && !QUALITY_LEVELS.includes(o.qualityLevel)) throw new BadRequestException('Mức chất lượng phải là 1, 2 hoặc 3');
    }
    if (input.generalScore !== undefined && input.generalScore !== null) assertGeneralScore(input.generalScore);
    return simulate(ctx, overrides, input.generalScore);
  }

  private async insightContext(actor: Actor, id: string, canReadAll: boolean) {
    const { evaluation, period } = await this.load(id);
    if (!(await this.canView(actor, evaluation, canReadAll))) throw new ForbiddenException('Bạn không có quyền xem hồ sơ đánh giá này');
    const frozen = evaluation.status === 'REVIEWED' || evaluation.status === 'APPROVED';
    const isLeader = await this.isLeader(evaluation.positionId);
    if (period.type === 'YEAR') {
      return { supported: false as const, reason: 'Điểm năm là trung bình các tháng đã phê duyệt (Nghị định 335 Điều 11), xem giải thích ở từng hồ sơ tháng.', frozen, isLeader };
    }
    if (await this.isSupport(evaluation.positionId)) {
      return { supported: false as const, reason: 'Vị trí hỗ trợ, phục vụ chấm theo ba tiêu chí chất lượng, tuân thủ quy trình, hiệu quả (Sổ tay Bộ Nội vụ Chương III), không theo dòng việc.', frozen, isLeader };
    }
    const [tasks, version] = await Promise.all([this.tasks.findByEvaluation(evaluation.id), this.requireVersion(period)]);
    const scored = toScored(tasks, version);
    const insightTasks: InsightTask[] = tasks.map((t, i) => ({ ...scored[i], id: t.id, code: t.catalogItemCode, name: version.items.get(t.catalogItemCode)?.name ?? t.catalogItemCode }));
    return {
      supported: true as const,
      frozen,
      tasks: insightTasks,
      generalScore: evaluation.generalScore ?? evaluation.selfGeneralScore,
      leadership: evaluation.leadership,
      isLeader,
    };
  }

  async addTask(actor: Actor, evaluationId: string, input: { catalogItemCode: string; plannedQuantity: number }): Promise<TaskModel> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['PLANNED']);
    this.assertActor(actor, (await this.authority(evaluation.personId, evaluation.positionId)).reviewer, 'giao chỉ tiêu cho');
    assertQuantity(input.plannedQuantity, 1, 'Số lượng giao');

    const version = await this.requireVersion(period);
    const item = version.items.get(input.catalogItemCode);
    if (!item) throw new NotFoundException(`Công việc ${input.catalogItemCode} không có trong danh mục của kỳ này`);
    if (item.coefficient === null || item.coefficient <= 0) {
      throw new ConflictException(`Công việc ${input.catalogItemCode} chưa có điểm chấm nên chưa giao được`);
    }
    const placement = await this.org.positionInfo(evaluation.positionId);
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
    this.assertActor(actor, (await this.authority(evaluation.personId, evaluation.positionId)).reviewer, 'sửa chỉ tiêu của');
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
  async selfSubmit(
    actor: Actor,
    evaluationId: string,
    input: { generalScore?: number; general?: GeneralMarkInput[]; support?: SupportScores; comment?: string | null },
  ): Promise<EvaluationModel> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['PLANNED']);
    this.assertSubject(actor, evaluation);
    const support = await this.isSupport(evaluation.positionId);
    if (!support && input.support) throw new BadRequestException(SUPPORT_ONLY);
    let selfSupport: SupportScores | null = null;
    let general: { score: number | null; marks: GeneralMarks | null } = { score: null, marks: null };
    // Kỳ năm không tự chấm điểm: điểm là trung bình các tháng đã phê duyệt (ADR-035).
    if (period.type !== 'YEAR') {
      general = await this.scoreGeneral(evaluation, period, input, 'Cá nhân', null);
      // Vị trí hỗ trợ, phục vụ tự đánh giá ba tiêu chí, không cần chỉ tiêu (Sổ tay Bộ Nội vụ Chương III).
      if (support) selfSupport = checkSupportScores(input.support, 'Người lao động');
      else if ((await this.tasks.findByEvaluation(evaluationId)).length === 0) {
        throw new ConflictException('Hồ sơ chưa có chỉ tiêu nào để tự chấm');
      }
    } else if (input.support || input.general) {
      throw new BadRequestException('Kỳ năm không tự chấm: điểm là trung bình các tháng đã phê duyệt');
    }

    const updated = await this.evaluations.update(evaluationId, {
      status: 'SELF_SUBMITTED',
      selfSupport,
      selfGeneralScore: general.score,
      selfGeneral: general.marks,
      selfComment: input.comment ?? null,
      selfSubmittedAt: this.clock.now(),
      returnReason: null,
    });
    await this.audit.record({
      action: 'evaluation.self-submit',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluationId,
      details: { period: period.label, selfGeneralScore: general.score, ...(general.marks ? { selfGeneral: general.marks } : {}), ...(selfSupport ? { selfSupport } : {}) },
    });
    await this.notifier.notify([(await this.authority(evaluation.personId, evaluation.positionId)).reviewer], {
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
    this.assertActor(actor, (await this.authority(evaluation.personId, evaluation.positionId)).reviewer, 'thẩm định hồ sơ của');
    if (period.type === 'YEAR') return this.reviewYear(actor, evaluation, period, input);
    const general = await this.scoreGeneral(evaluation, period, input, 'Người thẩm định', evaluation.selfGeneral);
    const generalScore = general.score!;
    if (await this.isSupport(evaluation.positionId)) return this.reviewSupport(actor, evaluation, period, general, input);
    if (input.support) throw new BadRequestException(SUPPORT_ONLY);

    const current = await this.tasks.findByEvaluation(evaluationId);
    const byId = new Map(current.map((t) => [t.id, t]));
    const patches = new Map<string, TaskPatch>();
    for (const edit of input.tasks ?? []) {
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
    const leader = await this.isLeader(evaluation.positionId);
    const leadership = this.checkLeadership(input.leadership, leader);
    const prospective = current.map((t) => ({ ...t, ...patches.get(t.id) }));
    const version = await this.requireVersion(period);
    const result = evaluate(toScored(prospective, version), generalScore, DEFAULT_SCORING_PARAMS, leadership, leader);
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
      generalScore,
      general: general.marks,
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
        generalScore,
        ...(general.marks ? { general: general.marks } : {}),
        resultScore: result.resultScore,
        totalScore: result.totalScore,
        rating: result.rating,
        policy: DEFAULT_SCORING_PARAMS.version,
        breakdown: result.breakdown,
        leadership,
        taskChanges: changes,
      },
    });
    await this.notifier.notify([(await this.authority(evaluation.personId, evaluation.positionId)).approver], {
      type: 'EVAL_REVIEWED',
      title: `Có hồ sơ đánh giá kỳ ${period.label} chờ bạn phê duyệt`,
      link: `/evaluations/${evaluationId}`,
    });
    return this.view(updated, period);
  }

  /**
   * Thẩm định hồ sơ năm: điểm là trung bình cộng các tháng đã phê duyệt (Nghị định 335 Điều 17.3), cần từ 6 tháng
   * (Điều 11.1). Người thẩm định chỉ nhận xét, không nhập điểm (ADR-035).
   */
  private async reviewYear(actor: Actor, evaluation: EvaluationModel, period: PeriodModel, input: ReviewInput): Promise<EvaluationView> {
    const average = await this.yearAverageOf(evaluation.personId, evaluation.positionId, period.year);
    if (!average.enough || average.totalScore === null || average.rating === null) {
      throw new ConflictException(
        `Mới có ${average.months.length} tháng đã phê duyệt và ${average.exempt.length} tháng nghỉ có căn cứ, cần ít nhất ${MIN_MONTHS_FOR_YEAR} tháng mới xếp loại năm (Nghị định 335 Điều 11.1). Hãy phê duyệt hồ sơ các tháng trước, hoặc đóng hồ sơ là "không xếp loại".`,
      );
    }
    // Có điều kiện "Không hoàn thành nhiệm vụ" thì mặc định xếp mức đó; người phê duyệt chỉ giữ mức theo điểm khi có ngoại lệ (ADR-055).
    const conditions = await this.conditionsOf(evaluation, period);
    const rating = conditions.length > 0 ? 'KHONG_HOAN_THANH' : average.rating;
    const updated = await this.evaluations.update(evaluation.id, {
      status: 'REVIEWED',
      generalScore: average.generalScore,
      resultScore: average.resultScore,
      totalScore: average.totalScore,
      rating,
      reviewComment: input.comment ?? null,
      reviewerAccountId: actor.id,
      reviewedAt: this.clock.now(),
      scoringParams: { policy: 'avg-months', months: average.months, missing: average.missing, exempt: average.exempt, ratingByScore: average.rating, conditions },
      leadership: null,
      returnReason: null,
    });
    await this.audit.record({
      action: 'evaluation.review',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluation.id,
      details: {
        period: period.label,
        policy: 'avg-months',
        generalScore: average.generalScore,
        resultScore: average.resultScore,
        totalScore: average.totalScore,
        rating,
        ratingByScore: average.rating,
        conditions: conditions.map((c) => c.code),
        months: average.months.length,
        missing: average.missing,
      },
    });
    await this.notifier.notify([(await this.authority(evaluation.personId, evaluation.positionId)).approver], {
      type: 'EVAL_REVIEWED',
      title: `Có hồ sơ đánh giá kỳ ${period.label} chờ bạn phê duyệt`,
      link: `/evaluations/${evaluation.id}`,
    });
    return this.view(updated, period);
  }

  /**
   * Các tháng đã phê duyệt của cán bộ trong năm và điểm trung bình (ADR-035), tính riêng cho từng vị trí (ADR-047):
   * phiếu năm của vị trí nào chỉ lấy phiếu tháng của vị trí đó. Riêng vị trí chính còn nhận tháng chỉ có một phiếu,
   * để cán bộ chuyển công tác giữa năm vẫn được tính trọn năm. Tháng nghỉ là của cán bộ nên áp cho mọi vị trí.
   */
  private async yearAverageOf(personId: string, positionId: string, year: number): Promise<YearAverage> {
    const exempt = (await this.leave.monthsOf(personId, year)).map((l) => l.month);
    const monthPeriods = (await this.periods.findAll()).filter((p) => p.type === 'MONTH' && p.year === year && p.number !== null);
    const held = await this.org.placementsDuring(personId, new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year, 11, 31, 23, 59, 59)));
    const concurrent = held.some((h) => h.positionId === positionId && h.kind === 'CONCURRENT') && !held.some((h) => h.positionId === positionId && h.kind === 'PRIMARY');
    const scores: MonthScore[] = [];
    for (const p of monthPeriods) {
      const all = await this.evaluations.findByPersonInPeriod(p.id, personId);
      const e = all.find((x) => x.positionId === positionId) ?? (!concurrent && all.length === 1 ? all[0] : undefined);
      if (e && e.status === 'APPROVED' && e.generalScore !== null && e.resultScore !== null && e.totalScore !== null) {
        scores.push({ month: p.number as number, label: p.label, generalScore: e.generalScore, resultScore: e.resultScore, totalScore: e.totalScore });
      }
    }
    return averageYear(scores, exempt);
  }

  // ---------------------------------------------------------- nghỉ và không xếp loại (ADR-039)

  /** Các tháng nghỉ có căn cứ của cán bộ trong năm. */
  async leaveOf(actor: Actor, personId: string, year: number, canReadAll: boolean): Promise<LeaveMonth[]> {
    if (!canReadAll && actor.personId !== personId && !(await this.isSuperiorOf(actor.personId, personId))) {
      throw new ForbiddenException('Bạn không được xem thông tin nghỉ của cán bộ này');
    }
    return this.leave.monthsOf(personId, year);
  }

  /**
   * Văn phòng ghi nhận các tháng nghỉ ốm, thai sản, nghỉ việc riêng không lương (Điều 11.2). Không ghi nhận cho tháng đã có
   * hồ sơ được phê duyệt, và không sửa khi hồ sơ năm đã khóa.
   */
  async setLeave(actor: Actor, personId: string, year: number, months: readonly LeaveMonth[]): Promise<LeaveMonth[]> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Năm phải từ 2000 đến 2100');
    const seen = new Set<number>();
    for (const m of months) {
      if (!Number.isInteger(m.month) || m.month < 1 || m.month > 12) throw new BadRequestException('Tháng phải từ 1 đến 12');
      if (seen.has(m.month)) throw new BadRequestException(`Tháng ${m.month} bị khai báo hai lần`);
      seen.add(m.month);
      if (!LEAVE_REASONS.includes(m.reason)) throw new BadRequestException('Lý do nghỉ không hợp lệ');
      if ((m.note?.trim().length ?? 0) < 3) throw new BadRequestException(`Tháng ${m.month}: cần nêu căn cứ nghỉ (số quyết định, giấy xác nhận)`);
    }
    const periods = await this.periods.findAll();
    const yearPeriod = periods.find((p) => p.type === 'YEAR' && p.year === year);
    if (yearPeriod) {
      const yearEvals = await this.evaluations.findByPersonInPeriod(yearPeriod.id, personId);
      if (yearEvals.some((e) => e.status === 'APPROVED')) throw new ConflictException(`Hồ sơ năm ${year} của cán bộ đã khóa, không sửa được tháng nghỉ`);
    }
    for (const p of periods.filter((x) => x.type === 'MONTH' && x.year === year && x.number !== null && seen.has(x.number))) {
      const evals = await this.evaluations.findByPersonInPeriod(p.id, personId);
      if (evals.some((e) => e.status === 'APPROVED')) throw new ConflictException(`Tháng ${p.number} đã có hồ sơ được phê duyệt, không ghi nhận là tháng nghỉ`);
    }
    const sorted = [...months].map((m) => ({ month: m.month, reason: m.reason, note: m.note!.trim() })).sort((a, b) => a.month - b.month);
    const before = await this.leave.monthsOf(personId, year);
    await this.leave.replace(personId, year, sorted, actor.id);
    await this.audit.record({
      action: 'evaluation.leave.update',
      outcome: 'SUCCESS',
      targetType: 'person',
      targetId: personId,
      details: { year, before: before.map((l) => ({ month: l.month, reason: l.reason })), after: sorted.map((l) => ({ month: l.month, reason: l.reason })) },
    });
    return sorted;
  }

  /**
   * Đóng hồ sơ năm là "không xếp loại" khi chưa đủ điều kiện (Điều 11.1): người thẩm định ghi lý do. Chỉ đóng được khi
   * thật sự chưa đủ tháng; hồ sơ chuyển sang trạng thái đã phê duyệt, không có điểm và xếp loại.
   */
  async closeNotRated(actor: Actor, evaluationId: string, comment?: string | null): Promise<EvaluationView> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    if (period.type !== 'YEAR') throw new BadRequestException('Chỉ hồ sơ năm mới đóng là "không xếp loại"');
    this.assertStatus(evaluation, ['PLANNED', 'SELF_SUBMITTED']);
    this.assertActor(actor, (await this.authority(evaluation.personId, evaluation.positionId)).reviewer, 'đóng hồ sơ không xếp loại của');
    const average = await this.yearAverageOf(evaluation.personId, evaluation.positionId, period.year);
    if (average.enough) throw new ConflictException(`Đã đủ ${MIN_MONTHS_FOR_YEAR} tháng để xếp loại (${average.months.length} tháng đã phê duyệt, ${average.exempt.length} tháng nghỉ): hãy thẩm định bình thường`);
    const reason = `Chưa đủ ${MIN_MONTHS_FOR_YEAR} tháng công tác trong năm (${average.months.length} tháng đã phê duyệt, ${average.exempt.length} tháng nghỉ có căn cứ) nên không xếp loại (Nghị định 335 Điều 11.1)${comment?.trim() ? `. ${comment.trim()}` : ''}`;
    const updated = await this.evaluations.update(evaluationId, {
      status: 'APPROVED',
      notRatedReason: reason,
      reviewerAccountId: actor.id,
      reviewedAt: this.clock.now(),
      approverAccountId: actor.id,
      approvedAt: this.clock.now(),
      approveComment: comment?.trim() || null,
      scoringParams: { policy: 'not-rated', months: average.months, exempt: average.exempt },
    });
    await this.audit.record({
      action: 'evaluation.not-rated',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluationId,
      details: { period: period.label, months: average.months.length, exempt: average.exempt, reason },
    });
    await this.notifier.notify([evaluation.personId], {
      type: 'EVAL_APPROVED',
      title: `Hồ sơ đánh giá kỳ ${period.label} được đóng là không xếp loại (chưa đủ thời gian công tác)`,
      link: `/evaluations/${evaluationId}`,
    });
    return this.view(updated, period);
  }

  /** Bước 4: người phê duyệt quyết định. Từ đây hồ sơ khóa. */
  /**
   * Bước 4: phê duyệt. Hồ sơ năm có điều kiện "Không hoàn thành nhiệm vụ" (ADR-055): người phê duyệt chỉ giữ mức theo điểm khi
   * chọn một ngoại lệ văn bản cho phép và ghi căn cứ; không chọn thì giữ "Không hoàn thành nhiệm vụ".
   */
  async approve(actor: Actor, evaluationId: string, comment?: string | null, exception?: { code: ConditionException; note: string } | null): Promise<EvaluationView> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['REVIEWED']);
    this.assertActor(actor, (await this.authority(evaluation.personId, evaluation.positionId)).approver, 'phê duyệt hồ sơ của');

    const params = evaluation.scoringParams ?? {};
    const conditions = (params.conditions as YearCondition[] | undefined) ?? [];
    let decided: { rating: EvaluationModel['rating']; scoringParams: Record<string, unknown> } | null = null;
    if (exception) {
      if (conditions.length === 0) throw new BadRequestException('Chỉ chọn ngoại lệ khi hồ sơ năm có điều kiện xếp loại "Không hoàn thành nhiệm vụ"');
      if (!Object.prototype.hasOwnProperty.call(CONDITION_EXCEPTIONS, exception.code)) throw new BadRequestException('Lý do ngoại lệ không hợp lệ');
      const note = exception.note?.trim();
      if (!note) throw new BadRequestException('Cần ghi căn cứ của ngoại lệ (hoàn cảnh, tính chất, mức độ vi phạm, kết quả khắc phục)');
      decided = { rating: (params.ratingByScore as EvaluationModel['rating']) ?? evaluation.rating, scoringParams: { ...params, exception: { code: exception.code, note, approverAccountId: actor.id } } };
    }

    const updated = await this.evaluations.update(evaluationId, {
      ...decided,
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
      details: {
        period: period.label,
        totalScore: updated.totalScore,
        rating: updated.rating,
        ...(conditions.length > 0 ? { conditions: conditions.map((c) => c.code), exception: exception ? { code: exception.code, note: exception.note.trim() } : null } : {}),
      },
    });
    await this.notifier.notify([evaluation.personId], { type: 'EVAL_APPROVED', title: `Hồ sơ đánh giá kỳ ${period.label} của bạn đã được phê duyệt`, link: `/evaluations/${evaluationId}` });
    return this.view(updated, period);
  }

  /**
   * Hủy kết quả đã phê duyệt để xếp loại lại (ADR-059; tham khảo Quy định 143-QĐ/TU Khánh Hòa Điều 2.7: phát hiện kết quả không bảo
   * đảm điều kiện, tiêu chuẩn thì người có thẩm quyền hủy kết quả và xếp loại lại). Người có thẩm quyền là người phê duyệt hồ sơ hoặc
   * cấp trên của người đó. Hồ sơ về bước giao mục tiêu (PLANNED), kết quả cũ lưu nguyên ở bản ghi hủy, cán bộ tự đánh giá lại.
   */
  async revoke(actor: Actor, evaluationId: string, input: { reasonCode: RevocationReason; note: string }): Promise<EvaluationView> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['APPROVED']);
    if (!Object.prototype.hasOwnProperty.call(REVOCATION_REASONS, input.reasonCode)) throw new BadRequestException('Lý do hủy không hợp lệ');
    const note = input.note?.trim() ?? '';
    if (note.length < 10) throw new BadRequestException('Cần nêu căn cứ hủy kết quả (ít nhất 10 ký tự)');
    if (note.length > 2000) throw new BadRequestException('Căn cứ hủy kết quả tối đa 2000 ký tự');

    const authority = await this.authority(evaluation.personId, evaluation.positionId);
    const competent = authority.holders.length > 1 ? authority.holders.slice(1) : authority.holders;
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa thao tác đánh giá được');
    if (competent.length === 0) throw new ConflictException('Chưa có người giữ vị trí cấp trên để thực hiện bước này');
    if (!competent.includes(actor.personId)) throw new ForbiddenException('Chỉ người phê duyệt hồ sơ hoặc cấp trên của người đó được hủy kết quả đã phê duyệt');

    // Điểm năm là trung bình các tháng đã phê duyệt: tháng đã nằm trong hồ sơ năm đã phê duyệt thì phải hủy hồ sơ năm trước.
    if (period.type === 'MONTH') {
      const yearPeriod = (await this.periods.findAll()).find((x) => x.type === 'YEAR' && x.year === period.year);
      if (yearPeriod && (await this.evaluations.findByPersonInPeriod(yearPeriod.id, evaluation.personId)).some((e) => e.status === 'APPROVED')) {
        throw new ConflictException(`Hồ sơ năm ${period.year} của cán bộ đã phê duyệt có dùng điểm tháng này: hãy hủy hồ sơ năm trước`);
      }
    }

    const tasks = await this.tasks.findByEvaluation(evaluationId);
    const previous = {
      period: period.label,
      status: evaluation.status,
      totalScore: evaluation.totalScore,
      resultScore: evaluation.resultScore,
      generalScore: evaluation.generalScore,
      rating: evaluation.rating,
      reviewComment: evaluation.reviewComment,
      reviewerAccountId: evaluation.reviewerAccountId,
      reviewedAt: evaluation.reviewedAt,
      approverAccountId: evaluation.approverAccountId,
      approvedAt: evaluation.approvedAt,
      approveComment: evaluation.approveComment,
      notRatedReason: evaluation.notRatedReason,
      scoringParams: evaluation.scoringParams,
      leadership: evaluation.leadership,
      support: evaluation.support,
      general: evaluation.general,
      tasks: tasks.map((t) => ({ catalogItemCode: t.catalogItemCode, plannedQuantity: t.plannedQuantity, completedQuantity: t.completedQuantity, qualityLevel: t.qualityLevel, lateCount: t.lateCount, reworkCount: t.reworkCount })),
    };
    const updated = await this.evaluations.revoke(
      evaluationId,
      {
        status: 'PLANNED',
        generalScore: null,
        reviewComment: null,
        reviewerAccountId: null,
        reviewedAt: null,
        approverAccountId: null,
        approvedAt: null,
        approveComment: null,
        notRatedReason: null,
        resultScore: null,
        totalScore: null,
        rating: null,
        scoringParams: null,
        leadership: null,
        support: null,
        general: null,
        returnReason: `Hủy kết quả đã phê duyệt để xếp loại lại: ${note}`,
      },
      { evaluationId, reasonCode: input.reasonCode, reason: note, revokedBy: actor.id, previous },
    );
    await this.audit.record({
      action: 'evaluation.revoke',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluationId,
      details: { period: period.label, reasonCode: input.reasonCode, reason: note, previousTotalScore: previous.totalScore, previousRating: previous.rating },
    });
    await this.notifier.notify([evaluation.personId, authority.reviewer], {
      type: 'EVAL_REVOKED',
      title: `Kết quả đánh giá kỳ ${period.label} đã bị hủy, cần đánh giá lại`,
      link: `/evaluations/${evaluationId}`,
    });
    return this.view(updated, period);
  }

  /** Trả hồ sơ về bước giao mục tiêu: người thẩm định trả hồ sơ đã tự chấm, người phê duyệt trả hồ sơ đã thẩm định. */
  async returnEvaluation(actor: Actor, evaluationId: string, reason: string): Promise<EvaluationModel> {
    const { evaluation, period } = await this.load(evaluationId);
    this.assertOpen(period);
    this.assertStatus(evaluation, ['SELF_SUBMITTED', 'REVIEWED']);
    if (reason.trim().length < 3) throw new BadRequestException('Cần nêu lý do trả lại');

    const authority = await this.authority(evaluation.personId, evaluation.positionId);
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
      support: null,
      general: null,
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
  private async authority(personId: string, positionId: string): Promise<Authority> {
    const holders = (await this.org.superiorsOf(personId, positionId)).flatMap((s) => (s.personId ? [s.personId] : []));
    return { holders, reviewer: holders[0] ?? null, approver: holders[1] ?? holders[0] ?? null };
  }

  /** Người này là cấp trên của cán bộ ở ít nhất một vị trí cán bộ đang giữ (kể cả kiêm nhiệm). */
  private async isSuperiorOf(actorPersonId: string | null, personId: string): Promise<boolean> {
    if (!actorPersonId) return false;
    const now = this.clock.now();
    const held = await this.org.placementsDuring(personId, now, now);
    const positions: (string | undefined)[] = held.length > 0 ? held.map((h) => h.positionId) : [undefined];
    for (const positionId of positions) {
      const chain = await this.org.superiorsOf(personId, positionId);
      if (chain.some((s) => s.personId === actorPersonId)) return true;
    }
    return false;
  }

  private async canView(actor: Actor, evaluation: EvaluationModel, canReadAll: boolean): Promise<boolean> {
    if (canReadAll) return true;
    if (!actor.personId) return false;
    if (actor.personId === evaluation.personId) return true;
    return (await this.authority(evaluation.personId, evaluation.positionId)).holders.includes(actor.personId);
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
      this.authority(evaluation.personId, evaluation.positionId),
    ]);
    const taskViews: TaskView[] = tasks.map((t) => {
      const info = version.items.get(t.catalogItemCode);
      return { ...t, name: info?.name ?? t.catalogItemCode, coefficient: info?.coefficient ?? null };
    });

    const frozen = evaluation.status === 'REVIEWED' || evaluation.status === 'APPROVED';
    const leader = await this.isLeader(evaluation.positionId);
    const support = await this.isSupport(evaluation.positionId);
    const scored = toScored(tasks, version);
    const live = support
      ? supportPreview(evaluation.support ?? evaluation.selfSupport, evaluation.generalScore ?? evaluation.selfGeneralScore)
      : evaluate(scored, evaluation.generalScore ?? evaluation.selfGeneralScore, DEFAULT_SCORING_PARAMS, evaluation.leadership, leader);
    const stored = (evaluation.scoringParams?.breakdown ?? null) as KpiBreakdown | null;
    const isYear = period.type === 'YEAR';
    const yearAverage = isYear ? await this.yearAverageOf(evaluation.personId, evaluation.positionId, period.year) : null;
    let preview: EvaluationView['preview'] =
      frozen && evaluation.resultScore !== null
        ? { resultScore: evaluation.resultScore, totalScore: evaluation.totalScore, rating: evaluation.rating, complete: true, breakdown: stored }
        : live;
    // Kỳ năm: điểm tạm tính là trung bình các tháng đã phê duyệt, không tính từ chỉ tiêu của hồ sơ năm (ADR-035).
    if (isYear && !(frozen && evaluation.resultScore !== null) && yearAverage) {
      preview = { resultScore: yearAverage.resultScore ?? 0, totalScore: yearAverage.totalScore, rating: yearAverage.rating, complete: yearAverage.enough, breakdown: null };
    }

    // Cảnh báo theo 05-HD/TU mục 8.2: chưa hoàn thành 100% số lượng giao thì xếp loại "Không hoàn thành nhiệm vụ",
    // trừ lý do khách quan được cấp có thẩm quyền xác nhận. Hệ thống chưa tự áp dụng (GAP G-18).
    const warnings: string[] = [];
    const quantity = isYear || support ? undefined : (frozen ? stored : live.breakdown)?.quantity;
    if (tasks.length > 0 && quantity !== undefined && quantity < 1) {
      warnings.push(
        'Chưa hoàn thành đủ số lượng giao: theo 05-HD/TU mục 8.2, cá nhân hoàn thành dưới 100% nhiệm vụ giao trong kỳ thì xếp loại "Không hoàn thành nhiệm vụ", trừ lý do khách quan, bất khả kháng được cấp có thẩm quyền xác nhận. Hệ thống chưa tự áp dụng quy định này.',
      );
    }

    if (yearAverage && evaluation.status !== 'APPROVED') {
      if (!yearAverage.enough) {
        warnings.push(
          `Mới có ${yearAverage.months.length} tháng đã phê duyệt và ${yearAverage.exempt.length} tháng nghỉ có căn cứ, chưa đủ ${MIN_MONTHS_FOR_YEAR} tháng nên chưa xếp loại năm được (Nghị định 335 Điều 11.1). Nếu không đủ điều kiện, người thẩm định đóng hồ sơ là "không xếp loại".`,
        );
      } else if (yearAverage.missing.length > 0) {
        warnings.push(
          `Điểm năm là trung bình ${yearAverage.months.length} tháng đã phê duyệt. Chưa có hồ sơ đã phê duyệt của tháng ${yearAverage.missing.join(', ')}: nếu thuộc nghỉ ốm, thai sản, nghỉ việc riêng (Điều 11.2) thì tính trên thời gian làm việc thực tế; nếu không, cần phê duyệt các tháng này trước khi thẩm định.`,
        );
      }
    }

    if (isYear && evaluation.status !== 'APPROVED') {
      const due = deadlineWarning(deadlineStatus(period, this.clock.now()));
      if (due) warnings.push(due);
    }

    // Điều 20.6: người đứng đầu không xếp cao hơn tổ chức của mình. Chỉ kỳ năm có xếp loại tập thể.
    if (period.type === 'YEAR' && preview.rating) {
      const unit = await this.unitRatings.of(evaluation.personId, period.id, evaluation.positionId);
      const warning = unit ? headRatingWarning(preview.rating, unit) : null;
      if (warning) warnings.push(warning);
    }

    // Hồ sơ đã chấm một ô 0–30 trước khi có bảng thì giữ nguyên, không hiện bảng.
    const legacyScored = !evaluation.selfGeneral && !evaluation.general && (evaluation.selfGeneralScore !== null || evaluation.generalScore !== null);
    const general = legacyScored ? null : await this.generalContext(evaluation, period);

    // Kỷ luật, kết luận trong kỳ (ADR-055): kỳ tháng, quý buộc Không đảm bảo các mục liên quan; kỳ năm xét điều kiện xếp loại.
    const ratingEvents = await this.ratingEvents.findByPerson(evaluation.personId, period.startDate, period.endDate);
    const forced = general ? [...forcedItems(ratingEvents, general.group)].filter(([code]) => general.set.items.some((i) => i.code === code)) : [];
    if (!isYear && ratingEvents.length > 0) {
      warnings.push(
        `Trong kỳ có ${ratingEvents.map(describeEvent).join('; ')}.${forced.length > 0 ? ` Các mục tiêu chí chung ${forced.map(([c]) => c).join(', ')} phải chấm Không đảm bảo (05-HD/TU mục IV.1.1).` : ''}`,
      );
    }
    const decided = evaluation.status === 'REVIEWED' || evaluation.status === 'APPROVED';
    const yearConditionList: YearCondition[] = !isYear
      ? []
      : decided
        ? ((evaluation.scoringParams?.conditions as YearCondition[] | undefined) ?? [])
        : await this.conditionsOf(evaluation, period);
    if (isYear && yearConditionList.length > 0 && evaluation.status !== 'APPROVED') {
      warnings.push(
        'Có điều kiện xếp loại "Không hoàn thành nhiệm vụ" (39-QĐ/TU Điều 11 mục 4): khi thẩm định, hồ sơ được xếp mức này. Người phê duyệt chỉ giữ mức theo điểm khi có ngoại lệ văn bản cho phép và ghi căn cứ.',
      );
    }

    // Hạn mức xuất sắc (ADR-060): chỉ gợi ý khi hồ sơ đã thẩm định ở mức xuất sắc.
    const quota = decided && preview.rating === 'XUAT_SAC' ? await this.quotaFor(evaluation, period) : null;
    if (quota) {
      const note = quotaMessage(quota, quota.mine ?? undefined);
      if (note && evaluation.status !== 'APPROVED') warnings.push(note);
    }

    return {
      evaluation,
      period,
      tasks: taskViews,
      preview,
      reviewerPersonId: authority.reviewer,
      approverPersonId: authority.approver,
      isLeader: leader,
      isSupport: support,
      leadershipSuggestion: leader && !isYear ? { unitResult: await this.suggestUnitResult(evaluation), ...(await this.suggestSolidarity(evaluation, period)) } : null,
      yearAverage,
      warnings,
      generalCriteria: general
        ? { ...general.set, versionId: general.version.id, effectiveFrom: general.version.effectiveFrom, note: general.version.note, group: general.group, groupLabel: GENERAL_GROUP_LABELS[general.group] }
        : null,
      previous: await this.previousLimitations(evaluation, period),
      ratingEvents,
      forcedItems: forced.map(([code, events]) => ({ code, reasons: events.map(describeEvent) })),
      yearConditions: yearConditionList,
      revocations: await this.evaluations.revocationsOf(evaluation.id),
      excellentQuota: quota,
    };
  }

  /** Các hồ sơ cùng nhóm "nhiệm vụ tương đồng" trong kỳ: cùng đơn vị, cùng loại vị trí (GAP G-40). */
  private async quotaPeers(period: PeriodModel): Promise<Map<string, { unitId: string | null; kind: PeriodQuotaGroup['kind']; rows: QuotaRow[]; size: number }>> {
    const infoCache = new Map<string, PositionInfo | null>();
    const groups = new Map<string, { unitId: string | null; kind: PeriodQuotaGroup['kind']; rows: QuotaRow[]; size: number }>();
    for (const e of await this.evaluations.findByPeriod(period.id)) {
      if (!infoCache.has(e.positionId)) infoCache.set(e.positionId, await this.org.positionInfo(e.positionId));
      const info = infoCache.get(e.positionId) ?? { positionId: e.positionId, level: 0 };
      const key = quotaGroupKey(info);
      const g = groups.get(key) ?? { unitId: info.unitId ?? null, kind: info.isLeader ? 'LEADER' : info.isSupport ? 'SUPPORT' : 'STAFF', rows: [], size: 0 };
      g.size += 1;
      if ((e.status === 'REVIEWED' || e.status === 'APPROVED') && e.rating && e.totalScore !== null) {
        g.rows.push({ evaluationId: e.id, personId: e.personId, score: e.totalScore, rating: e.rating });
      }
      groups.set(key, g);
    }
    return groups;
  }

  private async quotaFor(evaluation: EvaluationModel, period: PeriodModel): Promise<(ExcellentQuota & { mine: QuotaRanked | null }) | null> {
    const info = (await this.org.positionInfo(evaluation.positionId)) ?? { positionId: evaluation.positionId, level: 0 };
    const group = (await this.quotaPeers(period)).get(quotaGroupKey(info));
    if (!group) return null;
    const q = excellentQuota(group.rows, group.size);
    return { ...q, mine: q.ranking.find((r) => r.evaluationId === evaluation.id) ?? null };
  }

  /** Hạn mức xuất sắc của mọi nhóm trong kỳ, để người phê duyệt và Văn phòng xem một lượt (ADR-060). */
  async periodQuota(periodId: string): Promise<PeriodQuotaGroup[]> {
    const period = await this.requirePeriod(periodId);
    return [...(await this.quotaPeers(period)).values()].filter((g) => g.rows.length > 0).map((g) => ({ unitId: g.unitId, kind: g.kind, quota: excellentQuota(g.rows, g.size) }));
  }

  /** Vị trí hỗ trợ, phục vụ (ADR-053): có cờ trên vị trí việc làm. */
  private async isSupport(positionId: string): Promise<boolean> {
    return (await this.org.positionInfo(positionId))?.isSupport === true;
  }

  /**
   * Bảng tiêu chí chung áp dụng cho hồ sơ kỳ tháng, quý (ADR-054): phiên bản đã dùng khi chấm (nếu có), không thì phiên bản có
   * hiệu lực từ ngày bắt đầu kỳ; bảng lãnh đạo hay công chức theo cờ lãnh đạo của vị trí. null: kỳ năm hoặc chưa có bảng áp dụng.
   */
  private async generalContext(evaluation: EvaluationModel, period: PeriodModel): Promise<{ version: GeneralCriteriaVersion; group: GeneralGroup; set: GeneralCriteriaSet } | null> {
    if (period.type === 'YEAR') return null;
    const stored = evaluation.general ?? evaluation.selfGeneral;
    const version = (stored && (await this.criteria.findById(stored.versionId))) || effectiveVersion(await this.criteria.findAll(), period.startDate);
    if (!version) return null;
    const group: GeneralGroup = stored?.versionId === version.id ? stored.group : (await this.isLeader(evaluation.positionId)) ? 'LEADER' : 'STAFF';
    return { version, group, set: setOf(version, group) };
  }

  /**
   * Điểm tiêu chí chung khi tự chấm hoặc thẩm định kỳ tháng, quý. Có bảng áp dụng thì chấm từng mục Đảm bảo / Không đảm bảo
   * (05-HD/TU Phụ lục 03; Nghị định 335 Mẫu số 01); chưa có bảng thì nhập một điểm 0–30 như trước.
   */
  private async scoreGeneral(
    evaluation: EvaluationModel,
    period: PeriodModel,
    input: { generalScore?: number; general?: GeneralMarkInput[] },
    who: string,
    selfMarks: GeneralMarks | null,
  ): Promise<{ score: number; marks: GeneralMarks | null }> {
    // Chấm theo bảng hiện hành của vị trí, không theo phiên bản đã lưu của người thẩm định trước (hồ sơ có thể đã bị trả lại).
    const ctx = await this.generalContext({ ...evaluation, general: null, selfGeneral: selfMarks }, period);
    if (!ctx) {
      if (input.general) throw new BadRequestException('Kỳ này chưa có bảng tiêu chí chung theo mục: nhập một điểm tiêu chí chung từ 0 đến 30');
      const score = requireNumber(input.generalScore, who === 'Cá nhân' ? 'Điểm tiêu chí chung tự chấm' : 'Điểm tiêu chí chung');
      assertGeneralScore(score);
      return { score, marks: null };
    }
    if (input.generalScore !== undefined) throw new BadRequestException('Kỳ này chấm tiêu chí chung theo từng mục (Đảm bảo hoặc Không đảm bảo), không nhập một điểm');
    const compare = selfMarks && selfMarks.versionId === ctx.version.id && selfMarks.group === ctx.group ? selfMarks.items : null;
    const items = checkMarks(input.general, ctx.set, who, compare);
    // Kỳ có kỷ luật, kết luận có hiệu lực: mục liên quan không được chấm Đảm bảo (05-HD/TU mục IV.1.1; bộ tiêu chí mục 2.1.4).
    const forced = forcedItems(await this.ratingEvents.findByPerson(evaluation.personId, period.startDate, period.endDate), ctx.group);
    for (const m of items) {
      const events = forced.get(m.code);
      if (m.ok && events) throw new BadRequestException(`Mục ${m.code} phải là Không đảm bảo vì trong kỳ có: ${events.map(describeEvent).join('; ')}`);
    }
    return { score: scoreOf(items, ctx.set), marks: { versionId: ctx.version.id, group: ctx.group, items } };
  }

  /**
   * Điều kiện "Không hoàn thành nhiệm vụ" của năm (39-QĐ/TU Điều 11 mục 4; NĐ 335 Điều 11.3): sự kiện đã ghi nhận trong năm, và
   * số liệu tự tính từ việc được giao (lãnh đạo: đơn vị phụ trách dưới 70%; người khác: trên 50% việc chưa hoàn thành).
   */
  private async conditionsOf(evaluation: EvaluationModel, period: PeriodModel): Promise<YearCondition[]> {
    const leader = await this.isLeader(evaluation.positionId);
    const events = await this.ratingEvents.findByPerson(evaluation.personId, period.startDate, period.endDate);
    const figures: YearFigures = { unit: null, own: null };
    if (leader) {
      figures.unit = await this.completion.of(evaluation.positionId, period);
    } else {
      // Việc đột xuất tính ngoài số nhiệm vụ giao ban đầu (Điều 18.1.d). Việc không gắn vị trí thuộc vị trí chính.
      const primary = (await this.org.positionOf(evaluation.personId))?.positionId;
      const works = (await this.work.collect(period)).filter(
        (w) => w.personId === evaluation.personId && !isAdHocCode(w.catalogItemCode) && (w.positionId ?? primary) === evaluation.positionId,
      );
      if (works.length > 0) figures.own = { works: works.length, unfinished: works.filter((w) => w.confirmedQuantity < w.plannedQuantity).length };
    }
    return yearConditions(leader ? 'LEADER' : 'STAFF', events, figures);
  }

  /** Hạn chế người thẩm định nêu ở kỳ cùng loại liền trước (mục Không đảm bảo và nhận xét), để đối chiếu việc khắc phục. */
  private async previousLimitations(evaluation: EvaluationModel, period: PeriodModel): Promise<EvaluationView['previous']> {
    if (period.type === 'YEAR') return null;
    const before = (await this.periods.findAll()).filter((p) => p.type === period.type && p.endDate < period.startDate).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (!before) return null;
    const prev = await this.evaluations.findByPeriodPersonPosition(before.id, evaluation.personId, evaluation.positionId);
    if (!prev || (prev.status !== 'REVIEWED' && prev.status !== 'APPROVED')) return null;
    const failed: GeneralMark[] = prev.general?.items.filter((m) => !m.ok) ?? [];
    const version = failed.length > 0 && prev.general ? await this.criteria.findById(prev.general.versionId) : null;
    const names = new Map(version && prev.general ? setOf(version, prev.general.group).items.map((i) => [i.code, i.name]) : []);
    const limitations = failed.map((m) => ({ code: m.code, name: names.get(m.code) ?? m.code, note: m.note }));
    if (limitations.length === 0 && !prev.reviewComment) return null;
    return { periodLabel: before.label, reviewComment: prev.reviewComment, limitations };
  }

  /**
   * Thẩm định hồ sơ tháng, quý của vị trí hỗ trợ, phục vụ: người quản lý chấm tiêu chí chung và ba tiêu chí a, b, c; điểm
   * kết quả = (a + b + c) / 3 × 70 (Sổ tay Bộ Nội vụ Chương III). Chỉ tiêu (nếu có) chỉ để tham khảo, không tính điểm.
   */
  private async reviewSupport(
    actor: Actor,
    evaluation: EvaluationModel,
    period: PeriodModel,
    general: { score: number | null; marks: GeneralMarks | null },
    input: ReviewInput,
  ): Promise<EvaluationView> {
    if (input.leadership) throw new BadRequestException('Tiêu chí lãnh đạo, chỉ đạo (D) chỉ áp dụng cho cán bộ lãnh đạo, quản lý');
    if ((input.tasks ?? []).length > 0) throw new BadRequestException('Vị trí hỗ trợ, phục vụ không chấm theo dòng chỉ tiêu');
    const generalScore = general.score!;
    const support = checkSupportScores(input.support, 'Người quản lý');
    const resultScore = supportResultScore(support);
    const total = Math.round(totalScore(generalScore, resultScore) * 100) / 100;
    const rating = classifyByScore(total);
    const updated = await this.evaluations.update(evaluation.id, {
      status: 'REVIEWED',
      generalScore,
      general: general.marks,
      reviewComment: input.comment ?? null,
      reviewerAccountId: actor.id,
      reviewedAt: this.clock.now(),
      resultScore,
      totalScore: total,
      rating,
      scoringParams: { policy: SUPPORT_POLICY, rate: supportRate(support), resultMax: DEFAULT_SCORING_PARAMS.resultMax },
      leadership: null,
      support,
      returnReason: null,
    });
    await this.audit.record({
      action: 'evaluation.review',
      outcome: 'SUCCESS',
      targetType: 'evaluation',
      targetId: evaluation.id,
      details: { period: period.label, policy: SUPPORT_POLICY, generalScore, ...(general.marks ? { general: general.marks } : {}), support, resultScore, totalScore: total, rating },
    });
    await this.notifier.notify([(await this.authority(evaluation.personId, evaluation.positionId)).approver], {
      type: 'EVAL_REVIEWED',
      title: `Có hồ sơ đánh giá kỳ ${period.label} chờ bạn phê duyệt`,
      link: `/evaluations/${evaluation.id}`,
    });
    return this.view(updated, period);
  }

  /** Cán bộ lãnh đạo, quản lý: người giữ vị trí có cờ lãnh đạo (ADR-022); chưa có cờ thì theo cấp 1–4 (G-21). */
  private async isLeader(positionId: string): Promise<boolean> {
    const position = await this.org.positionInfo(positionId);
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
    const subordinates = new Set(await this.org.subordinateHolders(evaluation.personId, { direct: false, positionId: evaluation.positionId }));
    if (subordinates.size === 0) return null;
    const rated = (await this.evaluations.findByPeriod(evaluation.periodId)).filter(
      (e) => subordinates.has(e.personId) && (e.status === 'REVIEWED' || e.status === 'APPROVED') && e.rating !== null,
    );
    if (rated.length === 0) return null;
    return rated.some((e) => e.rating === 'KHONG_HOAN_THANH') ? 0.5 : 1;
  }

  /**
   * Gợi ý tiêu chí đoàn kết (Điều 15.3.c): 50% nếu trong kỳ đơn vị có phản ánh, khiếu nại về mâu thuẫn, mất đoàn kết nội bộ chưa
   * bị xác minh là sai; 100% nếu không có. Chỉ là gợi ý, người thẩm định quyết định (ADR-040). Không rõ đơn vị thì không gợi ý.
   */
  private async suggestSolidarity(evaluation: EvaluationModel, period: PeriodModel): Promise<{ solidarity: number | null; solidarityReason: string | null }> {
    const unitId = (await this.org.positionInfo(evaluation.positionId))?.unitId;
    if (!unitId) return { solidarity: null, solidarityReason: null };
    const count = await this.complaints.countSolidarityIssues(unitId, period.startDate, period.endDate);
    return count > 0
      ? { solidarity: 0.5, solidarityReason: `Đơn vị có ${count} phản ánh, khiếu nại về mất đoàn kết nội bộ trong kỳ chưa được xác minh là sai.` }
      : { solidarity: 1, solidarityReason: 'Trong kỳ đơn vị không có phản ánh, khiếu nại về mất đoàn kết nội bộ được ghi nhận trong hệ thống.' };
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

const periodStart = (p: PeriodModel): Date => new Date(`${p.startDate}T00:00:00Z`);
const periodEnd = (p: PeriodModel): Date => new Date(`${p.endDate}T23:59:59Z`);

function toScored(tasks: readonly TaskModel[], version: CatalogVersionInfo): ScoredTask[] {
  return tasks.map((t) => ({
    coefficient: version.items.get(t.catalogItemCode)?.coefficient ?? adHocCoefficient(t.catalogItemCode) ?? 0,
    plannedQuantity: t.plannedQuantity,
    completedQuantity: t.completedQuantity,
    qualityLevel: t.qualityLevel,
    lateCount: t.lateCount,
    reworkCount: t.reworkCount,
    extra: isAdHocCode(t.catalogItemCode),
  }));
}

function assertQuantity(value: number, min: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > MAX_QUANTITY) {
    throw new BadRequestException(`${label} phải là số nguyên từ ${min} đến ${MAX_QUANTITY}`);
  }
}

function requireNumber(value: number | undefined, label: string): number {
  if (value === undefined) throw new BadRequestException(`${label} là bắt buộc`);
  return value;
}

function assertGeneralScore(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > MAX_GENERAL_SCORE) {
    throw new BadRequestException(`Điểm tiêu chí chung phải từ 0 đến ${MAX_GENERAL_SCORE}`);
  }
}

const SUPPORT_ONLY = 'Ba tiêu chí chất lượng, tuân thủ quy trình, hiệu quả chỉ áp dụng cho vị trí hỗ trợ, phục vụ';

/** Điểm tạm tính của vị trí hỗ trợ, phục vụ từ ba tiêu chí (của người quản lý, chưa có thì của người lao động). */
function supportPreview(scores: SupportScores | null, generalScore: number | null): Evaluated {
  const resultScore = scores ? supportResultScore(scores) : 0;
  const total = generalScore === null ? null : Math.round(totalScore(generalScore, resultScore) * 100) / 100;
  const rate = scores ? supportRate(scores) : 0;
  return {
    resultScore,
    totalScore: total,
    rating: total === null ? null : classifyByScore(total),
    complete: scores !== null,
    // Không có a, b, c theo sản phẩm: chỉ ghi tỷ lệ chung để giao diện cũ không lỗi.
    breakdown: { quantity: rate, quality: rate, timeliness: rate, leadership: null, kpi: rate },
  };
}

/** Bộ cộng dồn cho một dòng chỉ tiêu khi gộp nhiều việc cùng mã công việc. */
function newLine() {
  return { planned: 0, completed: 0, late: 0, rework: 0, waivedLate: 0, waivedRework: 0, evidence: [] as string[], sources: [] as string[], titles: [] as string[] };
}
