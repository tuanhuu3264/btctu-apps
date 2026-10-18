import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { RatingEventRepository } from '../application/rating-events.js';
import type { NewRatingEvent, RatingEventModel } from '../application/rating-events.js';
import type {
  EvaluationModel,
  EvaluationPatch,
  NewEvaluation,
  NewPeriod,
  NewRevocation,
  NewTask,
  PeriodModel,
  RevocationModel,
  TaskModel,
  TaskPatch,
} from '../application/evaluation.model.js';
import { EvaluationRepository, PeriodRepository, TaskRepository } from '../application/evaluation.ports.js';
import type { NewUnitEvaluation, UnitEvaluationModel, UnitEvaluationPatch } from '../application/unit-evaluation.model.js';
import type { AxisDefinition } from '../application/unit-axes.js';
import { UnitAxisRepository, UnitEvaluationRepository } from '../application/unit-evaluation.ports.js';
import { LeaveRepository } from '../application/leave.js';
import type { LeaveMonth } from '../application/leave.js';
import { UnitComplaintRepository } from '../application/unit-complaint.js';
import type { NewUnitComplaint, UnitComplaintModel, UnitComplaintPatch } from '../application/unit-complaint.js';
import { GeneralCriteriaRepository } from '../application/general-criteria.js';
import type { GeneralCriteriaVersion, NewGeneralCriteriaVersion } from '../application/general-criteria.js';
import {
  EvaluationEntity,
  EvaluationPeriodEntity,
  EvaluationRevocationEntity,
  EvaluationTaskEntity,
  GeneralCriteriaVersionEntity,
  LeaveRecordEntity,
  RatingEventEntity,
  UnitAxisEntity,
  UnitComplaintEntity,
  UnitEvaluationEntity,
} from './evaluation.entities.js';

@Injectable()
export class TypeOrmPeriodRepository extends PeriodRepository {
  constructor(@InjectRepository(EvaluationPeriodEntity) private readonly repo: Repository<EvaluationPeriodEntity>) {
    super();
  }

  async findById(id: string): Promise<PeriodModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toPeriod(row) : null;
  }

  async findByLabel(label: string): Promise<PeriodModel | null> {
    const row = await this.repo.findOneBy({ label });
    return row ? toPeriod(row) : null;
  }

  async findAll(): Promise<PeriodModel[]> {
    return (await this.repo.find({ order: { startDate: 'DESC', label: 'ASC' } })).map(toPeriod);
  }

  async create(data: NewPeriod): Promise<PeriodModel> {
    return toPeriod(await this.repo.save(this.repo.create(data)));
  }

  async close(id: string): Promise<void> {
    await this.repo.update({ id }, { status: 'CLOSED' });
  }

  async setDeadline(id: string, date: string | null): Promise<void> {
    await this.repo.update({ id }, { ratingDeadline: date });
  }
}

@Injectable()
export class TypeOrmEvaluationRepository extends EvaluationRepository {
  constructor(@InjectRepository(EvaluationEntity) private readonly repo: Repository<EvaluationEntity>) {
    super();
  }

  async findById(id: string): Promise<EvaluationModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toEvaluation(row) : null;
  }

  async findByPeriodPersonPosition(periodId: string, personId: string, positionId: string): Promise<EvaluationModel | null> {
    const row = await this.repo.findOneBy({ periodId, personId, positionId });
    return row ? toEvaluation(row) : null;
  }

  async findByPersonInPeriod(periodId: string, personId: string): Promise<EvaluationModel[]> {
    return (await this.repo.find({ where: { periodId, personId }, order: { createdAt: 'ASC' } })).map(toEvaluation);
  }

  async findByPeriod(periodId: string): Promise<EvaluationModel[]> {
    return (await this.repo.find({ where: { periodId }, order: { createdAt: 'ASC' } })).map(toEvaluation);
  }

  async create(data: NewEvaluation): Promise<EvaluationModel> {
    return toEvaluation(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: EvaluationPatch): Promise<EvaluationModel> {
    // Giá trị null phải được ghi xuống (xóa trường), nên truyền thẳng patch đã lọc undefined.
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await this.repo.update({ id }, clean);
    return toEvaluation(await this.repo.findOneByOrFail({ id }));
  }

  async revoke(id: string, patch: EvaluationPatch, revocation: NewRevocation): Promise<EvaluationModel> {
    // Bản hủy và việc đưa hồ sơ về PLANNED phải nằm trong một giao dịch: trigger đối chiếu revoked_at với now() của giao dịch.
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return this.repo.manager.transaction(async (m) => {
      const repo = m.getRepository(EvaluationRevocationEntity);
      await repo.save(repo.create({ ...revocation }));
      await m.getRepository(EvaluationEntity).update({ id }, clean);
      return toEvaluation(await m.getRepository(EvaluationEntity).findOneByOrFail({ id }));
    });
  }

  async revocationsOf(evaluationId: string): Promise<RevocationModel[]> {
    const rows = await this.repo.manager.getRepository(EvaluationRevocationEntity).find({ where: { evaluationId }, order: { revokedAt: 'DESC' } });
    return rows.map((r) => ({ id: r.id, evaluationId: r.evaluationId, reasonCode: r.reasonCode, reason: r.reason, revokedBy: r.revokedBy, revokedAt: r.revokedAt, previous: r.previous }));
  }
}

@Injectable()
export class TypeOrmTaskRepository extends TaskRepository {
  constructor(@InjectRepository(EvaluationTaskEntity) private readonly repo: Repository<EvaluationTaskEntity>) {
    super();
  }

  async findById(id: string): Promise<TaskModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toTask(row) : null;
  }

  async findByEvaluation(evaluationId: string): Promise<TaskModel[]> {
    return (await this.repo.find({ where: { evaluationId }, order: { catalogItemCode: 'ASC' } })).map(toTask);
  }

  async create(data: NewTask): Promise<TaskModel> {
    return toTask(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: TaskPatch): Promise<TaskModel> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await this.repo.update({ id }, clean);
    return toTask(await this.repo.findOneByOrFail({ id }));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

const toPeriod = (e: EvaluationPeriodEntity): PeriodModel => ({
  id: e.id,
  type: e.type,
  year: e.year,
  number: e.number,
  label: e.label,
  startDate: e.startDate,
  endDate: e.endDate,
  catalogVersionId: e.catalogVersionId,
  status: e.status,
  ratingDeadline: e.ratingDeadline,
  createdBy: e.createdBy,
});

const toEvaluation = (e: EvaluationEntity): EvaluationModel => ({
  id: e.id,
  periodId: e.periodId,
  personId: e.personId,
  positionId: e.positionId,
  status: e.status,
  selfGeneralScore: e.selfGeneralScore,
  selfComment: e.selfComment,
  selfSubmittedAt: e.selfSubmittedAt,
  generalScore: e.generalScore,
  reviewComment: e.reviewComment,
  reviewerAccountId: e.reviewerAccountId,
  reviewedAt: e.reviewedAt,
  approverAccountId: e.approverAccountId,
  approvedAt: e.approvedAt,
  approveComment: e.approveComment,
  returnReason: e.returnReason,
  notRatedReason: e.notRatedReason,
  resultScore: e.resultScore,
  totalScore: e.totalScore,
  rating: e.rating,
  scoringParams: e.scoringParams,
  leadership: e.leadership,
  selfSupport: e.selfSupport,
  support: e.support,
  selfGeneral: e.selfGeneral,
  general: e.general,
  createdBy: e.createdBy,
});

const toTask = (e: EvaluationTaskEntity): TaskModel => ({
  id: e.id,
  evaluationId: e.evaluationId,
  catalogItemCode: e.catalogItemCode,
  plannedQuantity: e.plannedQuantity,
  completedQuantity: e.completedQuantity,
  qualityLevel: e.qualityLevel,
  evidence: e.evidence,
  sourceAssignmentIds: e.sourceAssignmentIds ?? [],
  sourceTaskTitles: e.sourceTaskTitles ?? [],
  lateCount: e.lateCount,
  reworkCount: e.reworkCount,
  waivedLateCount: e.waivedLateCount,
  waivedReworkCount: e.waivedReworkCount,
});

@Injectable()
export class TypeOrmUnitEvaluationRepository extends UnitEvaluationRepository {
  constructor(@InjectRepository(UnitEvaluationEntity) private readonly repo: Repository<UnitEvaluationEntity>) {
    super();
  }

  async findById(id: string): Promise<UnitEvaluationModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toUnitEvaluation(row) : null;
  }

  async findByPeriodAndUnit(periodId: string, unitId: string): Promise<UnitEvaluationModel | null> {
    const row = await this.repo.findOneBy({ periodId, unitId });
    return row ? toUnitEvaluation(row) : null;
  }

  async findByPeriod(periodId: string): Promise<UnitEvaluationModel[]> {
    return (await this.repo.find({ where: { periodId }, order: { createdAt: 'ASC' } })).map(toUnitEvaluation);
  }

  async create(data: NewUnitEvaluation): Promise<UnitEvaluationModel> {
    return toUnitEvaluation(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: UnitEvaluationPatch): Promise<UnitEvaluationModel> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await this.repo.update({ id }, clean);
    return toUnitEvaluation(await this.repo.findOneByOrFail({ id }));
  }
}

const toUnitEvaluation = (e: UnitEvaluationEntity): UnitEvaluationModel => ({
  id: e.id,
  periodId: e.periodId,
  unitId: e.unitId,
  status: e.status,
  selfGeneralScore: e.selfGeneralScore,
  selfResultScore: e.selfResultScore,
  selfComment: e.selfComment,
  selfSubmittedAt: e.selfSubmittedAt,
  generalScore: e.generalScore,
  resultScore: e.resultScore,
  reviewComment: e.reviewComment,
  reviewerAccountId: e.reviewerAccountId,
  reviewedAt: e.reviewedAt,
  approverAccountId: e.approverAccountId,
  approvedAt: e.approvedAt,
  approveComment: e.approveComment,
  returnReason: e.returnReason,
  totalScore: e.totalScore,
  rating: e.rating,
  metrics: e.metrics,
  selfAxisScores: e.selfAxisScores,
  axisScores: e.axisScores,
  createdBy: e.createdBy,
});

const toAxis = (e: UnitAxisEntity): AxisDefinition => ({
  code: e.code,
  name: e.name,
  kind: e.kind,
  maxPoints: e.maxPoints,
  sortOrder: e.sortOrder,
  autoMetric: e.autoMetric,
  active: e.active,
});

/** Cấu hình trục chấm điểm tập thể theo bộ (ADR-036, ADR-052). Thay cả một bộ trong một giao dịch. */
@Injectable()
export class TypeOrmUnitAxisRepository extends UnitAxisRepository {
  constructor(@InjectRepository(UnitAxisEntity) private readonly repo: Repository<UnitAxisEntity>) {
    super();
  }

  async findSet(unitId: string | null): Promise<AxisDefinition[]> {
    return (await this.repo.find({ where: { unitId: unitId ?? IsNull() }, order: { sortOrder: 'ASC', code: 'ASC' } })).map(toAxis);
  }

  async unitsWithOwnSet(): Promise<string[]> {
    const rows: { unit_id: string }[] = await this.repo.query(`SELECT DISTINCT unit_id FROM unit_axis WHERE unit_id IS NOT NULL`);
    return rows.map((r) => r.unit_id);
  }

  async replaceSet(unitId: string | null, axes: readonly AxisDefinition[]): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      const repo = m.getRepository(UnitAxisEntity);
      await repo.delete({ unitId: unitId ?? IsNull() });
      if (axes.length > 0) await repo.save(axes.map((a) => ({ ...a, unitId })));
    });
  }
}

const toComplaint = (e: UnitComplaintEntity): UnitComplaintModel => ({
  id: e.id,
  unitId: e.unitId,
  periodId: e.periodId,
  kind: e.kind,
  content: e.content,
  source: e.source,
  receivedOn: e.receivedOn,
  status: e.status,
  createdBy: e.createdBy,
  createdAt: e.createdAt,
  assignee: e.assignee,
  verifyDue: e.verifyDue,
  verifyDirectedBy: e.verifyDirectedBy,
  verifyDirectedAt: e.verifyDirectedAt,
  outcome: e.outcome,
  conclusion: e.conclusion,
  closedBy: e.closedBy,
  closedAt: e.closedAt,
});

/** Khiếu nại, phản ánh về tập thể (ADR-038). */
@Injectable()
export class TypeOrmUnitComplaintRepository extends UnitComplaintRepository {
  constructor(@InjectRepository(UnitComplaintEntity) private readonly repo: Repository<UnitComplaintEntity>) {
    super();
  }

  async create(data: NewUnitComplaint): Promise<UnitComplaintModel> {
    return toComplaint(await this.repo.save(this.repo.create(data)));
  }

  async findById(id: string): Promise<UnitComplaintModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toComplaint(row) : null;
  }

  async findByUnitAndPeriod(unitId: string, periodId: string): Promise<UnitComplaintModel[]> {
    return (await this.repo.find({ where: { unitId, periodId }, order: { createdAt: 'ASC' } })).map(toComplaint);
  }

  async openCounts(periodId: string): Promise<Map<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('c')
      .select('c.unit_id', 'unitId')
      .addSelect('COUNT(*)', 'n')
      .where('c.period_id = :periodId', { periodId })
      .andWhere("c.status <> 'CLOSED'")
      .groupBy('c.unit_id')
      .getRawMany<{ unitId: string; n: string }>();
    return new Map(rows.map((r) => [r.unitId, Number(r.n)]));
  }

  async countSolidarityIssues(unitId: string, from: string, to: string): Promise<number> {
    return this.repo
      .createQueryBuilder('c')
      .where('c.unit_id = :unitId', { unitId })
      .andWhere("c.kind = 'MAT_DOAN_KET'")
      .andWhere('c.received_on BETWEEN :from AND :to', { from, to })
      .andWhere("(c.status <> 'CLOSED' OR c.outcome IS DISTINCT FROM 'UNFOUNDED')")
      .getCount();
  }

  async update(id: string, patch: UnitComplaintPatch): Promise<UnitComplaintModel> {
    await this.repo.update({ id }, patch);
    return toComplaint(await this.repo.findOneByOrFail({ id }));
  }
}

const toCriteriaVersion = (e: GeneralCriteriaVersionEntity): GeneralCriteriaVersion => ({
  id: e.id,
  effectiveFrom: e.effectiveFrom,
  leader: e.leader,
  staff: e.staff,
  note: e.note,
  createdBy: e.createdBy,
  createdAt: e.createdAt,
});

/** Phiên bản bảng tiêu chí chung của cá nhân (ADR-054). */
@Injectable()
export class TypeOrmGeneralCriteriaRepository extends GeneralCriteriaRepository {
  constructor(@InjectRepository(GeneralCriteriaVersionEntity) private readonly repo: Repository<GeneralCriteriaVersionEntity>) {
    super();
  }

  async findAll(): Promise<GeneralCriteriaVersion[]> {
    return (await this.repo.find({ order: { effectiveFrom: 'ASC' } })).map(toCriteriaVersion);
  }

  async findById(id: string): Promise<GeneralCriteriaVersion | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toCriteriaVersion(row) : null;
  }

  async create(data: NewGeneralCriteriaVersion): Promise<GeneralCriteriaVersion> {
    return toCriteriaVersion(await this.repo.save(this.repo.create(data)));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

const toRatingEvent = (e: RatingEventEntity): RatingEventModel => ({
  id: e.id,
  personId: e.personId,
  kind: e.kind,
  effectiveDate: e.effectiveDate,
  decisionNo: e.decisionNo,
  form: e.form,
  system: e.system,
  reason: e.reason,
  note: e.note,
  createdBy: e.createdBy,
  createdAt: e.createdAt,
});

/** Sự kiện ảnh hưởng xếp loại cá nhân (ADR-055). */
@Injectable()
export class TypeOrmRatingEventRepository extends RatingEventRepository {
  constructor(@InjectRepository(RatingEventEntity) private readonly repo: Repository<RatingEventEntity>) {
    super();
  }

  async findByPerson(personId: string, from: string, to: string): Promise<RatingEventModel[]> {
    return (await this.repo.find({ where: { personId, effectiveDate: Between(from, to) }, order: { effectiveDate: 'ASC', createdAt: 'ASC' } })).map(toRatingEvent);
  }

  async findById(id: string): Promise<RatingEventModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toRatingEvent(row) : null;
  }

  async create(data: NewRatingEvent): Promise<RatingEventModel> {
    return toRatingEvent(await this.repo.save(this.repo.create(data)));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

/** Tháng nghỉ miễn tính khi đánh giá năm (ADR-039). */
@Injectable()
export class TypeOrmLeaveRepository extends LeaveRepository {
  constructor(@InjectRepository(LeaveRecordEntity) private readonly repo: Repository<LeaveRecordEntity>) {
    super();
  }

  async monthsOf(personId: string, year: number): Promise<LeaveMonth[]> {
    const rows = await this.repo.find({ where: { personId, year }, order: { month: 'ASC' } });
    return rows.map((r) => ({ month: r.month, reason: r.reason, note: r.note }));
  }

  async replace(personId: string, year: number, months: readonly LeaveMonth[], createdBy: string | null): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      const repo = m.getRepository(LeaveRecordEntity);
      await repo.delete({ personId, year });
      if (months.length > 0) await repo.save(months.map((x) => repo.create({ personId, year, month: x.month, reason: x.reason, note: x.note, createdBy })));
    });
  }
}
