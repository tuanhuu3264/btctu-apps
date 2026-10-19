import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import type { MemberModel, MemberRole, MilestoneModel, MilestonePatch, NewMilestone, NewProject, NewProjectAttachment, ProjectAttachmentModel, ProjectModel, ProjectPatch } from '../application/project.model.js';
import { MemberRepository, MilestoneRepository, ProjectAttachmentRepository, ProjectRepository } from '../application/project.ports.js';
import { ProjectAttachmentEntity, ProjectEntity, ProjectMemberEntity, ProjectMilestoneEntity } from './project.entities.js';

const toProject = (e: ProjectEntity): ProjectModel => ({
  id: e.id,
  code: e.code,
  kind: e.kind,
  title: e.title,
  objective: e.objective,
  description: e.description,
  ownerPersonId: e.ownerPersonId,
  unitId: e.unitId,
  startDate: e.startDate,
  endDate: e.endDate,
  status: e.status,
  createdByAccountId: e.createdByAccountId,
  submittedAt: e.submittedAt,
  approvedByAccountId: e.approvedByAccountId,
  approvedAt: e.approvedAt,
  returnReason: e.returnReason,
  completedOn: e.completedOn,
  closeNote: e.closeNote,
  createdAt: e.createdAt,
});

const toMilestone = (e: ProjectMilestoneEntity): MilestoneModel => ({
  id: e.id,
  projectId: e.projectId,
  title: e.title,
  dueDate: e.dueDate,
  weight: e.weight,
  assigneePersonId: e.assigneePersonId,
  status: e.status,
  completedOn: e.completedOn,
  note: e.note,
  createdAt: e.createdAt,
});

const toAttachment = (e: ProjectAttachmentEntity): ProjectAttachmentModel => ({
  id: e.id,
  projectId: e.projectId,
  fileName: e.fileName,
  contentType: e.contentType,
  sizeBytes: e.sizeBytes,
  storageKey: e.storageKey,
  uploadedByAccountId: e.uploadedByAccountId,
  createdAt: e.createdAt,
});

const defined = <T extends object>(patch: T): Partial<T> => Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

@Injectable()
export class TypeOrmProjectRepository extends ProjectRepository {
  constructor(@InjectRepository(ProjectEntity) private readonly repo: Repository<ProjectEntity>) {
    super();
  }

  async findById(id: string): Promise<ProjectModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toProject(row) : null;
  }

  async findAll(): Promise<ProjectModel[]> {
    return (await this.repo.find({ order: { createdAt: 'DESC' } })).map(toProject);
  }

  async findByIds(ids: readonly string[]): Promise<ProjectModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.find({ where: { id: In([...ids]) } })).map(toProject);
  }

  async nextSequence(prefix: string, year: number): Promise<number> {
    const rows = await this.repo.find({ where: { code: Like(`${prefix}-${year}-%`) }, select: { code: true } });
    return rows.reduce((max, r) => Math.max(max, Number(r.code.split('-')[2]) || 0), 0) + 1;
  }

  async create(data: NewProject): Promise<ProjectModel> {
    return toProject(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: ProjectPatch): Promise<ProjectModel> {
    const clean = defined(patch);
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    return toProject(await this.repo.findOneByOrFail({ id }));
  }
}

@Injectable()
export class TypeOrmMemberRepository extends MemberRepository {
  constructor(@InjectRepository(ProjectMemberEntity) private readonly repo: Repository<ProjectMemberEntity>) {
    super();
  }

  async findByProjects(projectIds: readonly string[]): Promise<MemberModel[]> {
    if (projectIds.length === 0) return [];
    return (await this.repo.find({ where: { projectId: In([...projectIds]) } })).map((m) => ({ projectId: m.projectId, personId: m.personId, role: m.role }));
  }

  async projectIdsOfPerson(personId: string): Promise<string[]> {
    return (await this.repo.find({ where: { personId } })).map((m) => m.projectId);
  }

  async add(projectId: string, personId: string, role: MemberRole): Promise<void> {
    await this.repo.upsert({ projectId, personId, role }, ['projectId', 'personId']);
  }

  async remove(projectId: string, personId: string): Promise<void> {
    await this.repo.delete({ projectId, personId });
  }

  async setRole(projectId: string, personId: string, role: MemberRole): Promise<void> {
    await this.repo.update({ projectId, personId }, { role });
  }
}

@Injectable()
export class TypeOrmMilestoneRepository extends MilestoneRepository {
  constructor(@InjectRepository(ProjectMilestoneEntity) private readonly repo: Repository<ProjectMilestoneEntity>) {
    super();
  }

  async findByProjects(projectIds: readonly string[]): Promise<MilestoneModel[]> {
    if (projectIds.length === 0) return [];
    return (await this.repo.find({ where: { projectId: In([...projectIds]) }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toMilestone);
  }

  async findById(id: string): Promise<MilestoneModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toMilestone(row) : null;
  }

  async projectIdsOfAssignee(personId: string): Promise<string[]> {
    return [...new Set((await this.repo.find({ where: { assigneePersonId: personId }, select: { projectId: true } })).map((m) => m.projectId))];
  }

  async create(data: NewMilestone): Promise<MilestoneModel> {
    return toMilestone(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: MilestonePatch): Promise<MilestoneModel> {
    const clean = defined(patch);
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    return toMilestone(await this.repo.findOneByOrFail({ id }));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

@Injectable()
export class TypeOrmProjectAttachmentRepository extends ProjectAttachmentRepository {
  constructor(@InjectRepository(ProjectAttachmentEntity) private readonly repo: Repository<ProjectAttachmentEntity>) {
    super();
  }

  async findByProject(projectId: string): Promise<ProjectAttachmentModel[]> {
    return (await this.repo.find({ where: { projectId }, order: { createdAt: 'ASC' } })).map(toAttachment);
  }

  async findById(id: string): Promise<ProjectAttachmentModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toAttachment(row) : null;
  }

  async create(data: NewProjectAttachment): Promise<ProjectAttachmentModel> {
    return toAttachment(await this.repo.save(this.repo.create(data)));
  }
}
