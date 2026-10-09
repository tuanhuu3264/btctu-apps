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
import { EvaluationEntity, EvaluationPeriodEntity, EvaluationTaskEntity } from './evaluation.entities.js';

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

  async findByPeriodAndPerson(periodId: string, personId: string): Promise<EvaluationModel | null> {
    const row = await this.repo.findOneBy({ periodId, personId });
    return row ? toEvaluation(row) : null;
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
