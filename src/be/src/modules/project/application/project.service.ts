import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import { buildExportFile, MAX_EXPORT_ROWS } from '../../../common/table-export.js';
import type { ExportedTable, TableFormat } from '../../../common/table-export.js';
import { AuditService } from '../../security/index.js';
import { FileStorage, validateUpload } from '../../tasking/index.js';
import type { UploadedFile } from '../../tasking/index.js';
import { buildProjectExport, projectStatistics, projectWarnings, progressOf, KIND_TEXT, STATUS_TEXT } from './project-report.js';
import type { Progress, ProjectStatistics, ProjectSummary, ProjectWarnings } from './project-report.js';
import {
  MAX_ATTACHMENTS,
  MAX_MEMBERS,
  MAX_MILESTONE_WEIGHT,
  MAX_MILESTONES,
  PROJECT_KINDS,
  PROJECT_STATUSES,
} from './project.model.js';
import type { MemberModel, MilestoneModel, ProjectAttachmentModel, ProjectKind, ProjectModel, ProjectPatch, ProjectStatus } from './project.model.js';
import { MemberRepository, MilestoneRepository, ProjectAttachmentRepository, ProjectOrgDirectory, ProjectRepository, ProjectWorkDirectory } from './project.ports.js';
import type { LinkedWork } from './project.ports.js';

export interface Actor {
  id: string;
  username: string;
  personId: string | null;
}

/** Quyền theo vai trò của người gọi, do lớp trình bày xác định; phạm vi theo người (chủ trì, thành viên) kiểm tra ở đây. */
export interface Caps {
  /** Xem toàn bộ đề án (Trưởng ban, Phó Trưởng ban, Văn phòng). */
  readAll: boolean;
  /** Duyệt, trả lại, nghiệm thu, hủy đề án của người khác (Trưởng ban). */
  approve: boolean;
}

export type Scope = 'mine' | 'team' | 'all';
export const SCOPES: readonly Scope[] = ['mine', 'team', 'all'];

export interface ListFilter {
  status?: ProjectStatus;
  kind?: ProjectKind;
  q?: string;
}

export interface ProjectRow {
  project: ProjectModel;
  ownerName: string;
  unitName: string;
  progress: Progress;
  memberCount: number;
  workCount: number;
}

export interface MemberView extends MemberModel {
  fullName: string;
}

export interface ProjectDetail {
  project: ProjectModel;
  ownerName: string;
  unitName: string;
  members: MemberView[];
  milestones: (MilestoneModel & { assigneeName: string | null; overdue: boolean })[];
  progress: Progress;
  attachments: Omit<ProjectAttachmentModel, 'storageKey'>[];
  work: (LinkedWork & { assigneeName: string })[];
  /** Thao tác người gọi làm được lúc này, để giao diện hiện đúng nút. */
  can: { edit: boolean; submit: boolean; approve: boolean; return: boolean; complete: boolean; cancel: boolean; manageMilestones: boolean; link: boolean; upload: boolean };
}

export interface CreateInput {
  kind: ProjectKind;
  title: string;
  objective?: string | null;
  description?: string | null;
  ownerPersonId?: string;
  startDate: string;
  endDate: string;
}

export interface MilestoneInput {
  title: string;
  dueDate: string;
  weight?: number;
  assigneePersonId?: string | null;
  note?: string | null;
}

const isoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const todayVn = (now: Date): string => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const clean = (s: string | null | undefined, max: number, label: string): string | null => {
  const v = s?.trim().replace(/[ \t]+/g, ' ');
  if (!v) return null;
  if (v.length > max) throw new BadRequestException(`${label} tối đa ${max} ký tự`);
  return v;
};

/** Đề án, dự án (ADR-050). Quyền theo vai trò kiểm tra ở lớp trình bày; ở đây kiểm tra phạm vi theo người và trạng thái. */
@Injectable()
export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly members: MemberRepository,
    private readonly milestones: MilestoneRepository,
    private readonly attachments: ProjectAttachmentRepository,
    private readonly org: ProjectOrgDirectory,
    private readonly work: ProjectWorkDirectory,
    private readonly storage: FileStorage,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  // ------------------------------------------------------------------ xem

  async list(actor: Actor, scope: Scope, caps: Caps, filter: ListFilter = {}): Promise<ProjectRow[]> {
    const summaries = await this.summaries(actor, scope, caps, filter);
    const today = todayVn(this.clock.now());
    const ids = summaries.map((s) => s.project.id);
    const [members, counts] = await Promise.all([this.members.findByProjects(ids), this.work.countByProject(ids)]);
    return summaries.map((s) => ({
      project: s.project,
      ownerName: s.ownerName,
      unitName: s.unitName,
      progress: progressOf(s.milestones, today),
      memberCount: members.filter((m) => m.projectId === s.project.id).length,
      workCount: counts.get(s.project.id) ?? 0,
    }));
  }

  async get(actor: Actor, id: string, caps: Caps): Promise<ProjectDetail> {
    const project = await this.require(id);
    await this.assertCanView(actor, project, caps);
    const [members, milestones, attachments, work, lookup] = await Promise.all([
      this.members.findByProjects([id]),
      this.milestones.findByProjects([id]),
      this.attachments.findByProject(id),
      this.work.linkedWork(id),
      this.org.lookup(),
    ]);
    const today = todayVn(this.clock.now());
    const name = (pid: string | null) => (pid ? (lookup.persons.get(pid)?.fullName ?? '(không rõ)') : null);
    const editor = this.isEditor(actor, project);
    const open = project.status === 'DRAFT' || project.status === 'ACTIVE';
    return {
      project,
      ownerName: name(project.ownerPersonId) ?? '',
      unitName: project.unitId ? (lookup.units.get(project.unitId)?.name ?? '(chưa rõ đơn vị)') : '(chưa rõ đơn vị)',
      members: members.map((m) => ({ ...m, fullName: name(m.personId) ?? '' })).sort((a, b) => (a.role === b.role ? a.fullName.localeCompare(b.fullName, 'vi') : a.role === 'LEAD' ? -1 : 1)),
      milestones: milestones
        .map((m) => ({ ...m, assigneeName: name(m.assigneePersonId), overdue: m.status !== 'DONE' && m.dueDate < today }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      progress: progressOf(milestones, today),
      attachments: attachments.map(({ storageKey: _k, ...rest }) => rest),
      work: work.map((w) => ({ ...w, assigneeName: name(w.assigneePersonId) ?? '' })),
      can: {
        edit: editor && open,
        submit: editor && project.status === 'DRAFT',
        approve: caps.approve && project.status === 'SUBMITTED' && actor.personId !== project.ownerPersonId,
        return: caps.approve && project.status === 'SUBMITTED',
        complete: caps.approve && project.status === 'ACTIVE',
        cancel: (editor && project.status === 'DRAFT') || (caps.approve && (project.status === 'SUBMITTED' || project.status === 'ACTIVE')),
        manageMilestones: editor && open,
        link: editor && (project.status === 'ACTIVE' || project.status === 'DRAFT'),
        upload: editor && project.status !== 'CANCELLED',
      },
    };
  }

  /** Mã và tên các đề án, để mô-đun khác (lịch họp) hiện nhãn; không kiểm tra quyền xem. */
  async labels(ids: readonly string[]): Promise<Map<string, { code: string; title: string }>> {
    return new Map((await this.projects.findByIds(ids)).map((p) => [p.id, { code: p.code, title: p.title }]));
  }

  /** Việc người gọi đã giao mà chưa gắn đề án nào, để chọn gắn vào đề án. */
  async linkCandidates(actor: Actor, projectId: string, caps: Caps): Promise<LinkedWork[]> {
    const project = await this.require(projectId);
    await this.assertCanView(actor, project, caps);
    if (!this.isEditor(actor, project)) throw new ForbiddenException('Chỉ chủ trì hoặc người lập đề án mới gắn việc vào đề án');
    return this.work.candidates(actor);
  }

  async statistics(actor: Actor, scope: Scope, caps: Caps, filter: ListFilter = {}): Promise<ProjectStatistics> {
    return projectStatistics(await this.summaries(actor, scope, caps, filter), todayVn(this.clock.now()));
  }

  async earlyWarning(actor: Actor, scope: Scope, caps: Caps): Promise<ProjectWarnings> {
    return projectWarnings(await this.summaries(actor, scope, caps, {}), todayVn(this.clock.now()));
  }

  async exportProjects(actor: Actor, scope: Scope, caps: Caps, filter: ListFilter, format: TableFormat): Promise<ExportedTable> {
    const all = await this.summaries(actor, scope, caps, filter);
    const limit = MAX_EXPORT_ROWS[format];
    const items = all.slice(0, limit);
    const lookup = await this.org.lookup();
    const names = (pid: string | null) => (pid ? (lookup.persons.get(pid)?.fullName ?? '(không rõ)') : '');
    const now = this.clock.now();
    const scopeText: Record<Scope, string> = { mine: 'Đề án của tôi', team: 'Đề án của cấp dưới và của tôi', all: 'Tất cả đề án' };
    const info: [string, string][] = [['Phạm vi', scopeText[scope]]];
    if (filter.status) info.push(['Trạng thái', STATUS_TEXT[filter.status]]);
    if (filter.kind) info.push(['Loại', KIND_TEXT[filter.kind]]);
    if (filter.q) info.push(['Từ khóa', filter.q]);
    if (all.length > limit) info.push(['Lưu ý', `Chỉ xuất ${items.length} đề án đầu tiên; hãy thu hẹp bộ lọc để xuất đủ.`]);
    const file = await buildExportFile('de-an-du-an', buildProjectExport(items, names, info, todayVn(now), now), format);
    await this.audit.record({
      action: 'project.export',
      outcome: 'SUCCESS',
      targetType: 'project',
      details: { format, scope, rows: items.length, truncated: all.length > limit, bytes: file.buffer.length, ...filter },
    });
    return file;
  }

  // ------------------------------------------------------------------ vòng đời

  async create(actor: Actor, input: CreateInput): Promise<ProjectModel> {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa lập đề án được');
    if (!PROJECT_KINDS.includes(input.kind)) throw new BadRequestException('Loại là đề án (DE_AN) hoặc dự án (DU_AN)');
    const title = this.title(input.title);
    this.assertDates(input.startDate, input.endDate);
    const owner = input.ownerPersonId ?? actor.personId;
    if (owner !== actor.personId) {
      if (!(await this.org.subordinateHolders(actor.personId, { direct: false })).includes(owner)) {
        throw new ForbiddenException('Chỉ giao chủ trì cho chính mình hoặc cán bộ thuộc quyền');
      }
    }
    if (!(await this.org.activePersonIds([owner])).has(owner)) throw new BadRequestException('Cán bộ chủ trì không còn được quản lý');

    const prefix = input.kind === 'DE_AN' ? 'DA' : 'DUA';
    const year = Number(input.startDate.slice(0, 4));
    const seq = await this.projects.nextSequence(prefix, year);
    const created = await this.projects.create({
      code: `${prefix}-${year}-${String(seq).padStart(3, '0')}`,
      kind: input.kind,
      title,
      objective: clean(input.objective, 4000, 'Mục tiêu'),
      description: clean(input.description, 8000, 'Nội dung'),
      ownerPersonId: owner,
      unitId: await this.org.unitOf(owner),
      startDate: input.startDate,
      endDate: input.endDate,
      createdByAccountId: actor.id,
    });
    await this.members.add(created.id, owner, 'LEAD');
    await this.record('project.create', created, { kind: created.kind, code: created.code, owner });
    return created;
  }

  async update(actor: Actor, id: string, patch: { title?: string; objective?: string | null; description?: string | null; startDate?: string; endDate?: string; ownerPersonId?: string }): Promise<ProjectModel> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    if (project.status !== 'DRAFT' && project.status !== 'ACTIVE') throw new ConflictException(`Đề án đang ở trạng thái ${STATUS_TEXT[project.status]}, không sửa được`);
    const draft = project.status === 'DRAFT';
    const next: ProjectPatch = {};
    if (patch.title !== undefined) {
      if (!draft) throw new ConflictException('Đề án đã duyệt: không đổi tên, chỉ sửa mục tiêu, nội dung, ngày kết thúc');
      next.title = this.title(patch.title);
    }
    if (patch.objective !== undefined) next.objective = clean(patch.objective, 4000, 'Mục tiêu');
    if (patch.description !== undefined) next.description = clean(patch.description, 8000, 'Nội dung');
    if (patch.startDate !== undefined) {
      if (!draft) throw new ConflictException('Đề án đã duyệt: không đổi ngày bắt đầu');
      next.startDate = patch.startDate;
    }
    if (patch.endDate !== undefined) next.endDate = patch.endDate;
    if (patch.ownerPersonId !== undefined) {
      if (!draft) throw new ConflictException('Đề án đã duyệt: không đổi người chủ trì');
      if (!actor.personId || !(await this.org.subordinateHolders(actor.personId, { direct: false })).concat(actor.personId).includes(patch.ownerPersonId)) {
        throw new ForbiddenException('Chỉ giao chủ trì cho chính mình hoặc cán bộ thuộc quyền');
      }
      if (!(await this.org.activePersonIds([patch.ownerPersonId])).has(patch.ownerPersonId)) throw new BadRequestException('Cán bộ chủ trì không còn được quản lý');
      next.ownerPersonId = patch.ownerPersonId;
      next.unitId = await this.org.unitOf(patch.ownerPersonId);
    }
    this.assertDates(next.startDate ?? project.startDate, next.endDate ?? project.endDate);
    const before = Object.fromEntries(Object.keys(next).map((k) => [k, (project as unknown as Record<string, unknown>)[k]]));
    const updated = await this.projects.update(id, next);
    if (next.ownerPersonId) {
      // Chủ trì mới thành LEAD (thêm vào nếu chưa là thành viên); chủ trì cũ ở lại làm thành viên.
      await this.members.add(id, next.ownerPersonId, 'LEAD');
      await this.members.setRole(id, project.ownerPersonId, 'MEMBER');
    }
    await this.record('project.update', updated, { before, after: next });
    return updated;
  }

  /** Trình duyệt: cần ít nhất một mốc tiến độ. */
  async submit(actor: Actor, id: string): Promise<ProjectModel> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT'], 'trình duyệt');
    if ((await this.milestones.findByProjects([id])).length === 0) throw new ConflictException('Cần ít nhất một mốc tiến độ trước khi trình duyệt');
    const updated = await this.projects.update(id, { status: 'SUBMITTED', submittedAt: this.clock.now(), returnReason: null });
    await this.record('project.submit', updated, {});
    await this.notifier.notifyPermitted('project:approve', actor.personId, { type: 'PROJECT_SUBMITTED', title: `Đề án chờ duyệt: ${project.code} ${project.title}`, link: `/projects/${id}` });
    return updated;
  }

  async approve(actor: Actor, id: string, caps: Caps): Promise<ProjectModel> {
    const project = await this.require(id);
    this.assertApprover(actor, caps);
    this.assertStatus(project, ['SUBMITTED'], 'phê duyệt');
    if (actor.personId === project.ownerPersonId) throw new ForbiddenException('Người chủ trì không tự phê duyệt đề án của mình');
    const updated = await this.projects.update(id, { status: 'ACTIVE', approvedByAccountId: actor.id, approvedAt: this.clock.now() });
    await this.record('project.approve', updated, {});
    await this.notifyMembers(id, actor, { type: 'PROJECT_DECIDED', title: `Đề án đã được phê duyệt: ${project.code} ${project.title}`, link: `/projects/${id}` });
    return updated;
  }

  async sendBack(actor: Actor, id: string, reason: string, caps: Caps): Promise<ProjectModel> {
    const project = await this.require(id);
    this.assertApprover(actor, caps);
    this.assertStatus(project, ['SUBMITTED'], 'trả lại');
    const why = clean(reason, 1000, 'Lý do');
    if (!why || why.length < 3) throw new BadRequestException('Cần nêu lý do trả lại (ít nhất 3 ký tự)');
    const updated = await this.projects.update(id, { status: 'DRAFT', returnReason: why, submittedAt: null });
    await this.record('project.return', updated, { reason: why });
    await this.notifier.notify([project.ownerPersonId], { type: 'PROJECT_DECIDED', title: `Đề án bị trả lại: ${project.code} ${project.title}`, link: `/projects/${id}` });
    return updated;
  }

  /** Nghiệm thu: mọi mốc phải xong. */
  async complete(actor: Actor, id: string, input: { completedOn?: string; note?: string | null }, caps: Caps): Promise<ProjectModel> {
    const project = await this.require(id);
    this.assertApprover(actor, caps);
    this.assertStatus(project, ['ACTIVE'], 'nghiệm thu');
    const pending = (await this.milestones.findByProjects([id])).filter((m) => m.status !== 'DONE');
    if (pending.length > 0) throw new ConflictException(`Còn ${pending.length} mốc chưa hoàn thành, chưa nghiệm thu được`);
    const today = todayVn(this.clock.now());
    const on = input.completedOn ?? today;
    if (!isoDate(on) || on > today) throw new BadRequestException('Ngày nghiệm thu phải có dạng YYYY-MM-DD và không ở tương lai');
    const updated = await this.projects.update(id, { status: 'COMPLETED', completedOn: on, closeNote: clean(input.note, 2000, 'Nhận xét') });
    await this.record('project.complete', updated, { completedOn: on });
    await this.notifyMembers(id, actor, { type: 'PROJECT_DECIDED', title: `Đề án đã nghiệm thu: ${project.code} ${project.title}`, link: `/projects/${id}` });
    return updated;
  }

  async cancel(actor: Actor, id: string, reason: string, caps: Caps): Promise<ProjectModel> {
    const project = await this.require(id);
    this.assertStatus(project, ['DRAFT', 'SUBMITTED', 'ACTIVE'], 'hủy');
    const allowed = (this.isEditor(actor, project) && project.status === 'DRAFT') || caps.approve;
    if (!allowed) throw new ForbiddenException(project.status === 'DRAFT' ? 'Chỉ chủ trì hoặc người lập mới hủy được đề án đang soạn' : 'Chỉ người có thẩm quyền phê duyệt mới hủy được đề án đã trình hoặc đang thực hiện');
    const why = clean(reason, 1000, 'Lý do');
    if (!why || why.length < 3) throw new BadRequestException('Cần nêu lý do hủy (ít nhất 3 ký tự)');
    const updated = await this.projects.update(id, { status: 'CANCELLED', closeNote: why });
    await this.record('project.cancel', updated, { reason: why, previousStatus: project.status });
    await this.notifyMembers(id, actor, { type: 'PROJECT_DECIDED', title: `Đề án đã hủy: ${project.code} ${project.title}`, link: `/projects/${id}` });
    return updated;
  }

  // ------------------------------------------------------------------ thành viên

  async addMember(actor: Actor, id: string, personId: string): Promise<void> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT', 'ACTIVE'], 'thêm thành viên');
    const current = await this.members.findByProjects([id]);
    if (current.some((m) => m.personId === personId)) throw new ConflictException('Cán bộ này đã là thành viên');
    if (current.length >= MAX_MEMBERS) throw new ConflictException(`Tối đa ${MAX_MEMBERS} thành viên`);
    if (!(await this.org.activePersonIds([personId])).has(personId)) throw new BadRequestException('Cán bộ không tồn tại hoặc không còn được quản lý');
    await this.members.add(id, personId, 'MEMBER');
    await this.record('project.member.add', project, { personId });
    await this.notifier.notify([personId], { type: 'PROJECT_MEMBER_ADDED', title: `Bạn được thêm vào ${KIND_TEXT[project.kind].toLowerCase()}: ${project.code} ${project.title}`, link: `/projects/${id}` });
  }

  async removeMember(actor: Actor, id: string, personId: string): Promise<void> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT', 'ACTIVE'], 'bớt thành viên');
    if (personId === project.ownerPersonId) throw new ConflictException('Không bớt người chủ trì; hãy đổi chủ trì trước');
    const current = await this.members.findByProjects([id]);
    if (!current.some((m) => m.personId === personId)) throw new NotFoundException('Cán bộ này không phải thành viên');
    if ((await this.milestones.findByProjects([id])).some((m) => m.assigneePersonId === personId && m.status !== 'DONE')) {
      throw new ConflictException('Cán bộ này còn mốc chưa xong được giao: hãy chuyển mốc cho người khác trước');
    }
    await this.members.remove(id, personId);
    await this.record('project.member.remove', project, { personId });
  }

  // ------------------------------------------------------------------ mốc tiến độ

  async addMilestone(actor: Actor, id: string, input: MilestoneInput): Promise<MilestoneModel> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT', 'ACTIVE'], 'thêm mốc');
    if ((await this.milestones.findByProjects([id])).length >= MAX_MILESTONES) throw new ConflictException(`Tối đa ${MAX_MILESTONES} mốc`);
    const data = await this.milestoneData(project, input);
    const created = await this.milestones.create({ projectId: id, ...data });
    await this.record('project.milestone.add', project, { milestoneId: created.id, title: created.title, dueDate: created.dueDate });
    if (created.assigneePersonId && created.assigneePersonId !== actor.personId) {
      await this.notifier.notify([created.assigneePersonId], { type: 'PROJECT_MILESTONE_ASSIGNED', title: `Bạn được giao mốc "${created.title}" của ${project.code}`, link: `/projects/${id}` });
    }
    return created;
  }

  async updateMilestone(actor: Actor, id: string, milestoneId: string, input: Partial<MilestoneInput>): Promise<MilestoneModel> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT', 'ACTIVE'], 'sửa mốc');
    const m = await this.requireMilestone(id, milestoneId);
    if (m.status === 'DONE') throw new ConflictException('Mốc đã hoàn thành: hãy mở lại mốc trước khi sửa');
    const merged = await this.milestoneData(project, {
      title: input.title ?? m.title,
      dueDate: input.dueDate ?? m.dueDate,
      weight: input.weight ?? m.weight,
      assigneePersonId: input.assigneePersonId === undefined ? m.assigneePersonId : input.assigneePersonId,
      note: input.note === undefined ? m.note : input.note,
    });
    const updated = await this.milestones.update(milestoneId, merged);
    await this.record('project.milestone.update', project, { milestoneId, before: { title: m.title, dueDate: m.dueDate, weight: m.weight, assigneePersonId: m.assigneePersonId }, after: merged });
    if (merged.assigneePersonId && merged.assigneePersonId !== m.assigneePersonId && merged.assigneePersonId !== actor.personId) {
      await this.notifier.notify([merged.assigneePersonId], { type: 'PROJECT_MILESTONE_ASSIGNED', title: `Bạn được giao mốc "${merged.title}" của ${project.code}`, link: `/projects/${id}` });
    }
    return updated;
  }

  async deleteMilestone(actor: Actor, id: string, milestoneId: string): Promise<void> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT', 'ACTIVE'], 'xóa mốc');
    const m = await this.requireMilestone(id, milestoneId);
    if (m.status === 'DONE') throw new ConflictException('Mốc đã hoàn thành, không xóa được');
    await this.milestones.delete(milestoneId);
    await this.record('project.milestone.remove', project, { milestoneId, title: m.title });
  }

  /** Báo mốc đã xong: chủ trì, người lập hoặc người phụ trách mốc; đề án phải đang thực hiện. */
  async completeMilestone(actor: Actor, id: string, milestoneId: string, input: { completedOn?: string; note?: string | null }): Promise<MilestoneModel> {
    const project = await this.require(id);
    this.assertStatus(project, ['ACTIVE'], 'báo hoàn thành mốc');
    const m = await this.requireMilestone(id, milestoneId);
    if (!this.isEditor(actor, project) && !(actor.personId && actor.personId === m.assigneePersonId)) {
      throw new ForbiddenException('Chỉ chủ trì, người lập hoặc người phụ trách mốc mới báo hoàn thành');
    }
    if (m.status === 'DONE') throw new ConflictException('Mốc đã hoàn thành');
    const today = todayVn(this.clock.now());
    const on = input.completedOn ?? today;
    if (!isoDate(on) || on > today) throw new BadRequestException('Ngày hoàn thành phải có dạng YYYY-MM-DD và không ở tương lai');
    if (on < project.startDate) throw new BadRequestException('Ngày hoàn thành không được trước ngày bắt đầu đề án');
    const updated = await this.milestones.update(milestoneId, { status: 'DONE', completedOn: on, note: input.note === undefined ? m.note : clean(input.note, 1000, 'Ghi chú') });
    await this.record('project.milestone.done', project, { milestoneId, title: m.title, completedOn: on, late: on > m.dueDate });
    return updated;
  }

  async reopenMilestone(actor: Actor, id: string, milestoneId: string): Promise<MilestoneModel> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['ACTIVE'], 'mở lại mốc');
    const m = await this.requireMilestone(id, milestoneId);
    if (m.status !== 'DONE') throw new ConflictException('Mốc chưa hoàn thành');
    const updated = await this.milestones.update(milestoneId, { status: 'PENDING', completedOn: null });
    await this.record('project.milestone.reopen', project, { milestoneId, title: m.title });
    return updated;
  }

  // ------------------------------------------------------------------ tài liệu

  async upload(actor: Actor, id: string, file: UploadedFile): Promise<Omit<ProjectAttachmentModel, 'storageKey'>> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    if (project.status === 'CANCELLED') throw new ConflictException('Đề án đã hủy, không đính kèm thêm được');
    if ((await this.attachments.findByProject(id)).length >= MAX_ATTACHMENTS) throw new ConflictException(`Tối đa ${MAX_ATTACHMENTS} tệp mỗi đề án`);
    const { fileName, contentType } = validateUpload(file);
    const key = `projects/${id}/${randomUUID()}`;
    await this.storage.put(key, file.buffer, contentType);
    const { storageKey: _k, ...created } = await this.attachments.create({ projectId: id, fileName, contentType, sizeBytes: file.size, storageKey: key, uploadedByAccountId: actor.id });
    await this.record('project.attachment.upload', project, { attachmentId: created.id, fileName, sizeBytes: file.size });
    return created;
  }

  async download(actor: Actor, id: string, attachmentId: string, caps: Caps): Promise<{ attachment: ProjectAttachmentModel; data: Buffer }> {
    const project = await this.require(id);
    await this.assertCanView(actor, project, caps);
    const attachment = await this.attachments.findById(attachmentId);
    if (!attachment || attachment.projectId !== id) throw new NotFoundException('Không tìm thấy tệp đính kèm');
    const data = await this.storage.get(attachment.storageKey);
    await this.record('project.attachment.download', project, { attachmentId, fileName: attachment.fileName, sizeBytes: attachment.sizeBytes });
    return { attachment, data };
  }

  // ------------------------------------------------------------------ việc được giao gắn vào đề án

  async linkWork(actor: Actor, id: string, assignmentId: string): Promise<void> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT', 'ACTIVE'], 'gắn việc');
    const linked = await this.work.link(actor, assignmentId, id);
    await this.record('project.link', project, { assignmentId, title: linked.title, assigneePersonId: linked.assigneePersonId });
  }

  async unlinkWork(actor: Actor, id: string, assignmentId: string): Promise<void> {
    const project = await this.require(id);
    this.assertEditor(actor, project);
    this.assertStatus(project, ['DRAFT', 'ACTIVE'], 'gỡ việc');
    if (!(await this.work.linkedWork(id)).some((w) => w.assignmentId === assignmentId)) throw new NotFoundException('Việc này không thuộc đề án');
    await this.work.link(actor, assignmentId, null);
    await this.record('project.unlink', project, { assignmentId });
  }

  // ------------------------------------------------------------------ nội bộ

  /** Đề án trong phạm vi, kèm mốc và tên, đã lọc, mới nhất trước. */
  private async summaries(actor: Actor, scope: Scope, caps: Caps, filter: ListFilter): Promise<ProjectSummary[]> {
    if (!SCOPES.includes(scope)) throw new BadRequestException('Phạm vi là mine, team hoặc all');
    if (filter.status !== undefined && !PROJECT_STATUSES.includes(filter.status)) throw new BadRequestException(`Trạng thái không hợp lệ: ${filter.status}`);
    if (filter.kind !== undefined && !PROJECT_KINDS.includes(filter.kind)) throw new BadRequestException(`Loại không hợp lệ: ${filter.kind}`);
    let rows: ProjectModel[];
    if (scope === 'all') {
      if (!caps.readAll) throw new ForbiddenException('Bạn không có quyền xem toàn bộ đề án');
      rows = await this.projects.findAll();
    } else {
      const ids = new Set<string>();
      if (actor.personId) {
        for (const pid of await this.members.projectIdsOfPerson(actor.personId)) ids.add(pid);
        for (const pid of await this.milestones.projectIdsOfAssignee(actor.personId)) ids.add(pid);
      }
      const mine = [...(await this.projects.findByIds([...ids])), ...(await this.projects.findAll()).filter((p) => p.createdByAccountId === actor.id)];
      const set = new Map(mine.map((p) => [p.id, p]));
      if (scope === 'team' && actor.personId) {
        const team = new Set(await this.org.subordinateHolders(actor.personId, { direct: false }));
        for (const p of await this.projects.findAll()) if (team.has(p.ownerPersonId)) set.set(p.id, p);
      }
      rows = [...set.values()];
    }
    const words = fold(filter.q ?? '').split(/\s+/).filter(Boolean);
    const lookup = await this.org.lookup();
    const filtered = rows.filter((p) => (!filter.status || p.status === filter.status) && (!filter.kind || p.kind === filter.kind));
    const milestones = await this.milestones.findByProjects(filtered.map((p) => p.id));
    return filtered
      .map((project) => ({
        project,
        milestones: milestones.filter((m) => m.projectId === project.id),
        ownerName: lookup.persons.get(project.ownerPersonId)?.fullName ?? '(không rõ)',
        unitName: project.unitId ? (lookup.units.get(project.unitId)?.name ?? '(chưa rõ đơn vị)') : '(chưa rõ đơn vị)',
      }))
      .filter((s) => words.every((w) => fold(`${s.project.code} ${s.project.title} ${s.ownerName} ${s.unitName}`).includes(w)))
      .sort((a, b) => b.project.createdAt.getTime() - a.project.createdAt.getTime());
  }

  private async require(id: string): Promise<ProjectModel> {
    const p = await this.projects.findById(id);
    if (!p) throw new NotFoundException(`Không tìm thấy đề án: ${id}`);
    return p;
  }

  private async requireMilestone(projectId: string, milestoneId: string): Promise<MilestoneModel> {
    const m = await this.milestones.findById(milestoneId);
    if (!m || m.projectId !== projectId) throw new NotFoundException('Không tìm thấy mốc tiến độ');
    return m;
  }

  /** Chủ trì hoặc người lập. */
  private isEditor(actor: Actor, project: ProjectModel): boolean {
    return actor.id === project.createdByAccountId || (!!actor.personId && actor.personId === project.ownerPersonId);
  }

  private assertEditor(actor: Actor, project: ProjectModel): void {
    if (!this.isEditor(actor, project)) throw new ForbiddenException('Chỉ chủ trì hoặc người lập đề án mới thực hiện được thao tác này');
  }

  private assertApprover(actor: Actor, caps: Caps): void {
    if (!caps.approve) throw new ForbiddenException('Chỉ người có thẩm quyền phê duyệt đề án mới thực hiện được thao tác này');
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ');
  }

  private assertStatus(project: ProjectModel, allowed: ProjectStatus[], action: string): void {
    if (!allowed.includes(project.status)) throw new ConflictException(`Đề án đang ở trạng thái "${STATUS_TEXT[project.status]}", không ${action} được`);
  }

  private async assertCanView(actor: Actor, project: ProjectModel, caps: Caps): Promise<void> {
    if (caps.readAll || caps.approve || actor.id === project.createdByAccountId) return;
    const person = actor.personId;
    if (person) {
      if (person === project.ownerPersonId) return;
      if ((await this.members.findByProjects([project.id])).some((m) => m.personId === person)) return;
      if ((await this.milestones.findByProjects([project.id])).some((m) => m.assigneePersonId === person)) return;
      if ((await this.org.subordinateHolders(person, { direct: false })).includes(project.ownerPersonId)) return;
    }
    throw new ForbiddenException('Bạn không có quyền xem đề án này');
  }

  private title(raw: string): string {
    const t = raw?.trim().replace(/\s+/g, ' ') ?? '';
    if (t.length < 3 || t.length > 200) throw new BadRequestException('Tên dài từ 3 đến 200 ký tự');
    return t;
  }

  private assertDates(start: string, end: string): void {
    if (!isoDate(start) || !isoDate(end)) throw new BadRequestException('Ngày bắt đầu và kết thúc có dạng YYYY-MM-DD');
    if (end < start) throw new BadRequestException('Ngày kết thúc không được trước ngày bắt đầu');
  }

  private async milestoneData(project: ProjectModel, input: MilestoneInput) {
    const title = this.title(input.title);
    if (!isoDate(input.dueDate)) throw new BadRequestException('Hạn của mốc có dạng YYYY-MM-DD');
    if (input.dueDate < project.startDate || input.dueDate > project.endDate) throw new BadRequestException(`Hạn của mốc phải nằm trong thời gian đề án (${project.startDate} đến ${project.endDate})`);
    const weight = input.weight ?? 1;
    if (!Number.isInteger(weight) || weight < 1 || weight > MAX_MILESTONE_WEIGHT) throw new BadRequestException(`Trọng số là số nguyên từ 1 đến ${MAX_MILESTONE_WEIGHT}`);
    let assignee: string | null = null;
    if (input.assigneePersonId) {
      const isMember = (await this.members.findByProjects([project.id])).some((m) => m.personId === input.assigneePersonId);
      if (!isMember) throw new BadRequestException('Người phụ trách mốc phải là thành viên của đề án');
      assignee = input.assigneePersonId;
    }
    return { title, dueDate: input.dueDate, weight, assigneePersonId: assignee, note: clean(input.note, 1000, 'Ghi chú') };
  }

  private async notifyMembers(id: string, actor: Actor, content: Parameters<Notifier['notify']>[1]): Promise<void> {
    const members = await this.members.findByProjects([id]);
    await this.notifier.notify(members.map((m) => m.personId).filter((p) => p !== actor.personId), content);
  }

  private async record(action: string, project: ProjectModel, details: Record<string, unknown>): Promise<void> {
    await this.audit.record({ action, outcome: 'SUCCESS', targetType: 'project', targetId: project.id, details: { code: project.code, ...details } });
  }
}

/** Bỏ dấu và chữ hoa để tìm không phân biệt dấu. */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

