import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import type {
  AssignmentModel,
  AssignmentPatch,
  AssignmentStatus,
  AttachmentModel,
  CommentModel,
  NewAssignment,
  NewAttachment,
  NewComment,
  NewProgress,
  NewWaiver,
  NewWorkTask,
  ProgressModel,
  ProgressPatch,
  WaiverModel,
  WorkTaskModel,
} from '../application/tasking.model.js';
import type { NewRecurringTemplate, RecurringTemplateModel, RecurringTemplatePatch } from '../application/recurring.model.js';
import {
  AssignmentRepository,
  AttachmentRepository,
  CommentRepository,
  ConsultantRepository,
  ProgressRepository,
  RecurringTemplateRepository,
  WaiverRepository,
  WorkTaskRepository,
} from '../application/tasking.ports.js';
import {
  WorkAssignmentEntity,
  WorkAttachmentEntity,
  WorkCommentEntity,
  WorkConsultantEntity,
  RecurringTemplateEntity,
  WorkProgressEntity,
  WorkProgressWaiverEntity,
  WorkTaskEntity,
} from './tasking.entities.js';

@Injectable()
export class TypeOrmAssignmentRepository extends AssignmentRepository {
  constructor(@InjectRepository(WorkAssignmentEntity) private readonly repo: Repository<WorkAssignmentEntity>) {
    super();
  }

  async findById(id: string): Promise<AssignmentModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toAssignment(row) : null;
  }

  async findByAssignees(personIds: readonly string[]): Promise<AssignmentModel[]> {
    if (personIds.length === 0) return [];
    return (await this.repo.find({ where: { assigneePersonId: In([...personIds]) }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toAssignment);
  }

  async findAll(): Promise<AssignmentModel[]> {
    return (await this.repo.find({ order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toAssignment);
  }

  async findByIds(ids: readonly string[]): Promise<AssignmentModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.find({ where: { id: In([...ids]) }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toAssignment);
  }

  async findByAssigner(accountId: string): Promise<AssignmentModel[]> {
    return (await this.repo.find({ where: { assignerAccountId: accountId }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toAssignment);
  }

  async findByApprover(personId: string): Promise<AssignmentModel[]> {
    return (await this.repo.find({ where: { approverPersonId: personId }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toAssignment);
  }

  async findByProject(projectId: string): Promise<AssignmentModel[]> {
    return (await this.repo.find({ where: { projectId }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toAssignment);
  }

  async findRecurringKeys(templateId: string): Promise<Set<string>> {
    const rows = await this.repo.find({ where: { recurringTemplateId: templateId }, select: { recurringKey: true } });
    return new Set(rows.flatMap((r) => (r.recurringKey ? [r.recurringKey] : [])));
  }

  async findByTemplate(templateId: string): Promise<AssignmentModel[]> {
    return (await this.repo.find({ where: { recurringTemplateId: templateId }, order: { dueDate: 'ASC' } })).map(toAssignment);
  }

  async update(id: string, patch: AssignmentPatch): Promise<AssignmentModel> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    return toAssignment(await this.repo.findOneByOrFail({ id }));
  }

  async findOpenDueBetween(from: string, to: string): Promise<AssignmentModel[]> {
    return (await this.repo.find({ where: { status: 'OPEN', dueDate: Between(from, to) }, order: { dueDate: 'ASC' } })).map(toAssignment);
  }

  async create(data: NewAssignment): Promise<AssignmentModel> {
    return toAssignment(await this.repo.save(this.repo.create(data)));
  }

  async setStatus(id: string, status: AssignmentStatus): Promise<AssignmentModel> {
    await this.repo.update({ id }, { status });
    return toAssignment(await this.repo.findOneByOrFail({ id }));
  }
}

@Injectable()
export class TypeOrmWorkTaskRepository extends WorkTaskRepository {
  constructor(@InjectRepository(WorkTaskEntity) private readonly repo: Repository<WorkTaskEntity>) {
    super();
  }

  async findById(id: string): Promise<WorkTaskModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toWorkTask(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<WorkTaskModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.find({ where: { id: In([...ids]) } })).map(toWorkTask);
  }

  async findByAssignees(personIds: readonly string[]): Promise<WorkTaskModel[]> {
    if (personIds.length === 0) return [];
    return (await this.repo.find({ where: { assigneePersonId: In([...personIds]) }, order: { title: 'ASC' } })).map(toWorkTask);
  }

  async findAll(): Promise<WorkTaskModel[]> {
    return (await this.repo.find({ order: { title: 'ASC' } })).map(toWorkTask);
  }

  async findByAssigneeAndTitle(personId: string, title: string): Promise<WorkTaskModel | null> {
    const row = await this.repo
      .createQueryBuilder('t')
      .where('t.assignee_person_id = :personId AND lower(t.title) = lower(:title)', { personId, title })
      .getOne();
    return row ? toWorkTask(row) : null;
  }

  async create(data: NewWorkTask): Promise<WorkTaskModel> {
    return toWorkTask(await this.repo.save(this.repo.create(data)));
  }
}

@Injectable()
export class TypeOrmProgressRepository extends ProgressRepository {
  constructor(@InjectRepository(WorkProgressEntity) private readonly repo: Repository<WorkProgressEntity>) {
    super();
  }

  async findById(id: string): Promise<ProgressModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toProgress(row) : null;
  }

  async findByAssignments(assignmentIds: readonly string[]): Promise<ProgressModel[]> {
    if (assignmentIds.length === 0) return [];
    return (await this.repo.find({ where: { assignmentId: In([...assignmentIds]) }, order: { completedOn: 'ASC', reportedAt: 'ASC' } })).map(toProgress);
  }

  async create(data: NewProgress): Promise<ProgressModel> {
    return toProgress(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: ProgressPatch): Promise<ProgressModel> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await this.repo.update({ id }, clean);
    return toProgress(await this.repo.findOneByOrFail({ id }));
  }
}

const toWaiver = (e: WorkProgressWaiverEntity): WaiverModel => ({
  id: e.id,
  progressId: e.progressId,
  kind: e.kind,
  reason: e.reason,
  grantedBy: e.grantedBy,
  grantedAt: e.grantedAt,
  revokedBy: e.revokedBy,
  revokedAt: e.revokedAt,
  revokeNote: e.revokeNote,
});

@Injectable()
export class TypeOrmWaiverRepository extends WaiverRepository {
  constructor(@InjectRepository(WorkProgressWaiverEntity) private readonly repo: Repository<WorkProgressWaiverEntity>) {
    super();
  }

  async findByProgress(progressIds: readonly string[]): Promise<WaiverModel[]> {
    if (progressIds.length === 0) return [];
    return (await this.repo.find({ where: { progressId: In([...progressIds]) }, order: { grantedAt: 'ASC' } })).map(toWaiver);
  }

  async create(data: NewWaiver): Promise<WaiverModel> {
    return toWaiver(await this.repo.save(this.repo.create(data)));
  }

  async revoke(id: string, by: string, at: Date, note: string): Promise<WaiverModel> {
    await this.repo.update({ id }, { revokedBy: by, revokedAt: at, revokeNote: note });
    return toWaiver(await this.repo.findOneByOrFail({ id }));
  }
}

@Injectable()
export class TypeOrmConsultantRepository extends ConsultantRepository {
  constructor(@InjectRepository(WorkConsultantEntity) private readonly repo: Repository<WorkConsultantEntity>) {
    super();
  }

  async findByAssignments(assignmentIds: readonly string[]): Promise<{ assignmentId: string; personId: string }[]> {
    if (assignmentIds.length === 0) return [];
    return (await this.repo.find({ where: { assignmentId: In([...assignmentIds]) }, order: { addedAt: 'ASC' } })).map((r) => ({ assignmentId: r.assignmentId, personId: r.personId }));
  }

  async findAssignmentIds(personId: string): Promise<string[]> {
    return (await this.repo.find({ where: { personId } })).map((r) => r.assignmentId);
  }

  async replace(assignmentId: string, personIds: readonly string[]): Promise<void> {
    await this.repo.manager.transaction(async (m) => {
      const repo = m.getRepository(WorkConsultantEntity);
      await repo.delete({ assignmentId });
      if (personIds.length > 0) await repo.insert(personIds.map((personId) => repo.create({ assignmentId, personId })));
    });
  }
}

@Injectable()
export class TypeOrmCommentRepository extends CommentRepository {
  constructor(@InjectRepository(WorkCommentEntity) private readonly repo: Repository<WorkCommentEntity>) {
    super();
  }

  async findByAssignment(assignmentId: string): Promise<CommentModel[]> {
    return (await this.repo.find({ where: { assignmentId }, order: { createdAt: 'ASC' } })).map(toComment);
  }

  async findById(id: string): Promise<CommentModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toComment(row) : null;
  }

  async create(data: NewComment): Promise<CommentModel> {
    return toComment(await this.repo.save(this.repo.create(data)));
  }
}

@Injectable()
export class TypeOrmAttachmentRepository extends AttachmentRepository {
  constructor(@InjectRepository(WorkAttachmentEntity) private readonly repo: Repository<WorkAttachmentEntity>) {
    super();
  }

  async findByAssignment(assignmentId: string): Promise<AttachmentModel[]> {
    return (await this.repo.find({ where: { assignmentId }, order: { uploadedAt: 'ASC' } })).map(toAttachment);
  }

  async findByAssignments(assignmentIds: readonly string[]): Promise<AttachmentModel[]> {
    if (assignmentIds.length === 0) return [];
    return (await this.repo.find({ where: { assignmentId: In([...assignmentIds]) }, order: { uploadedAt: 'DESC' } })).map(toAttachment);
  }

  async findById(id: string): Promise<AttachmentModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toAttachment(row) : null;
  }

  async create(data: NewAttachment): Promise<AttachmentModel> {
    return toAttachment(await this.repo.save(this.repo.create(data)));
  }
}

const toComment = (e: WorkCommentEntity): CommentModel => ({
  id: e.id,
  assignmentId: e.assignmentId,
  authorAccountId: e.authorAccountId,
  authorPersonId: e.authorPersonId,
  kind: e.kind,
  body: e.body,
  createdAt: e.createdAt,
});

const toAttachment = (e: WorkAttachmentEntity): AttachmentModel => ({
  id: e.id,
  assignmentId: e.assignmentId,
  commentId: e.commentId,
  fileName: e.fileName,
  contentType: e.contentType,
  sizeBytes: e.sizeBytes,
  storageKey: e.storageKey,
  uploadedByAccountId: e.uploadedByAccountId,
  uploadedAt: e.uploadedAt,
});

const toWorkTask = (e: WorkTaskEntity): WorkTaskModel => ({
  id: e.id,
  assigneePersonId: e.assigneePersonId,
  title: e.title,
  description: e.description,
  createdByAccountId: e.createdByAccountId,
});

const toAssignment = (e: WorkAssignmentEntity): AssignmentModel => ({
  id: e.id,
  taskId: e.taskId,
  assigneePersonId: e.assigneePersonId,
  assignerAccountId: e.assignerAccountId,
  catalogItemCode: e.catalogItemCode,
  catalogVersionId: e.catalogVersionId,
  plannedQuantity: e.plannedQuantity,
  dueDate: e.dueDate,
  periodMode: e.periodMode,
  reportKinds: e.reportKinds,
  note: e.note,
  status: e.status,
  approverPersonId: e.approverPersonId,
  okrKeyResult: e.okrKeyResult,
  createdAt: e.createdAt,
  source: e.source,
  title: e.title,
  recurringTemplateId: e.recurringTemplateId,
  recurringKey: e.recurringKey,
  positionId: e.positionId,
  projectId: e.projectId,
});

const toProgress = (e: WorkProgressEntity): ProgressModel => ({
  id: e.id,
  assignmentId: e.assignmentId,
  quantity: e.quantity,
  completedOn: e.completedOn,
  evidence: e.evidence,
  status: e.status,
  reportedBy: e.reportedBy,
  decidedBy: e.decidedBy,
  decidedAt: e.decidedAt,
  decisionNote: e.decisionNote,
  majorError: e.majorError,
});

@Injectable()
export class TypeOrmRecurringTemplateRepository extends RecurringTemplateRepository {
  constructor(@InjectRepository(RecurringTemplateEntity) private readonly repo: Repository<RecurringTemplateEntity>) {
    super();
  }

  async findById(id: string): Promise<RecurringTemplateModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toTemplate(row) : null;
  }

  async findAll(): Promise<RecurringTemplateModel[]> {
    return (await this.repo.find({ order: { createdAt: 'DESC' } })).map(toTemplate);
  }

  async findActive(): Promise<RecurringTemplateModel[]> {
    return (await this.repo.find({ where: { status: 'ACTIVE' }, order: { createdAt: 'ASC' } })).map(toTemplate);
  }

  async create(data: NewRecurringTemplate): Promise<RecurringTemplateModel> {
    return toTemplate(await this.repo.save(this.repo.create({ ...data, status: 'ACTIVE', inactiveAt: null, lastRunAt: null, lastError: null })));
  }

  async update(id: string, patch: RecurringTemplatePatch): Promise<RecurringTemplateModel> {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    return toTemplate(await this.repo.findOneByOrFail({ id }));
  }
}

const toTemplate = (e: RecurringTemplateEntity): RecurringTemplateModel => ({
  id: e.id,
  assigneePersonId: e.assigneePersonId,
  taskId: e.taskId,
  source: e.source,
  catalogItemCode: e.catalogItemCode,
  title: e.title,
  plannedQuantity: e.plannedQuantity,
  frequency: e.frequency,
  startDate: e.startDate,
  endDate: e.endDate,
  dueAfterDays: e.dueAfterDays,
  periodMode: e.periodMode,
  reportKinds: e.reportKinds,
  note: e.note,
  approverPersonId: e.approverPersonId,
  status: e.status,
  createdBy: e.createdBy,
  createdAt: e.createdAt,
  inactiveAt: e.inactiveAt,
  lastRunAt: e.lastRunAt,
  lastError: e.lastError,
});
