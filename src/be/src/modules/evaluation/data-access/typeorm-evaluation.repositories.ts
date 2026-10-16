import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  EvaluationModel,
  EvaluationPatch,
  NewEvaluation,
  NewPeriod,
  NewTask,
  PeriodModel,
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
import { EvaluationEntity, EvaluationPeriodEntity, EvaluationTaskEntity, LeaveRecordEntity, UnitAxisEntity, UnitComplaintEntity, UnitEvaluationEntity } from './evaluation.entities.js';

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

/** Cấu hình trục chấm điểm tập thể (ADR-036). Thay cả danh sách trong một giao dịch. */
@Injectable()
export class TypeOrmUnitAxisRepository extends UnitAxisRepository {
  constructor(@InjectRepository(UnitAxisEntity) private readonly repo: Repository<UnitAxisEntity>) {
    super();
  }

  async findAll(): Promise<AxisDefinition[]> {
    return (await this.repo.find({ order: { sortOrder: 'ASC', code: 'ASC' } })).map(toAxis);
  }

  async replaceAll(axes: readonly AxisDefinition[]): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      await m.getRepository(UnitAxisEntity).clear();
      await m.getRepository(UnitAxisEntity).save(axes.map((a) => ({ ...a })));
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
