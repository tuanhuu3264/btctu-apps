import { Test } from '@nestjs/testing';
import { Clock } from '../../../../common/clock.js';
import { Notifier } from '../../../../common/notifier.js';
import { FakeNotifier } from '../../../../common/testing/fake-notifier.js';
import { AuditService } from '../../../security/index.js';
import { FileStorage } from '../../../tasking/index.js';
import type {
  MemberModel,
  MemberRole,
  MilestoneModel,
  MilestonePatch,
  NewMilestone,
  NewProject,
  NewProjectAttachment,
  ProjectAttachmentModel,
  ProjectModel,
  ProjectPatch,
} from '../project.model.js';
import { MemberRepository, MilestoneRepository, ProjectAttachmentRepository, ProjectOrgDirectory, ProjectRepository, ProjectWorkDirectory } from '../project.ports.js';
import type { LinkedWork } from '../project.ports.js';
import { ProjectService } from '../project.service.js';
import type { Actor, Caps } from '../project.service.js';

/** Đối tượng giả dùng chung cho test lớp nghiệp vụ của mô-đun project. */
export const PEOPLE = { boss: 'p-boss', deputy: 'p-deputy', head: 'p-head', staff: 'p-staff', other: 'p-other', outsider: 'p-outsider' } as const;
export type Who = keyof typeof PEOPLE;

export const actorOf = (who: Who | null): Actor => (who === null ? { id: 'acc-none', username: 'none', personId: null } : { id: `acc-${who}`, username: who, personId: PEOPLE[who] });

export const CAPS: Record<Who, Caps> = {
  boss: { readAll: true, approve: true },
  deputy: { readAll: true, approve: false },
  head: { readAll: false, approve: false },
  staff: { readAll: false, approve: false },
  other: { readAll: false, approve: false },
  outsider: { readAll: false, approve: false },
};

class FakeClock extends Clock {
  current = new Date('2026-10-10T03:00:00Z'); // 10:00 giờ Việt Nam
  now() {
    return new Date(this.current);
  }
}

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

class InMemoryProjects extends ProjectRepository {
  rows: ProjectModel[] = [];
  async findById(id: string) {
    const r = this.rows.find((p) => p.id === id);
    return r ? { ...r } : null;
  }
  async findAll() {
    return this.rows.map((p) => ({ ...p }));
  }
  async findByIds(ids: readonly string[]) {
    return this.rows.filter((p) => ids.includes(p.id)).map((p) => ({ ...p }));
  }
  async nextSequence(prefix: string, year: number) {
    return this.rows.filter((p) => p.code.startsWith(`${prefix}-${year}-`)).length + 1;
  }
  async create(data: NewProject) {
    const row: ProjectModel = {
      ...data,
      id: nextId('pr'),
      status: 'DRAFT',
      submittedAt: null,
      approvedByAccountId: null,
      approvedAt: null,
      returnReason: null,
      completedOn: null,
      closeNote: null,
      createdAt: new Date(this.rows.length + 1),
    };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: ProjectPatch) {
    const row = this.rows.find((p) => p.id === id)!;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return { ...row };
  }
}

class InMemoryMembers extends MemberRepository {
  rows: MemberModel[] = [];
  async findByProjects(ids: readonly string[]) {
    return this.rows.filter((m) => ids.includes(m.projectId)).map((m) => ({ ...m }));
  }
  async projectIdsOfPerson(personId: string) {
    return this.rows.filter((m) => m.personId === personId).map((m) => m.projectId);
  }
  async add(projectId: string, personId: string, role: MemberRole) {
    const existing = this.rows.find((m) => m.projectId === projectId && m.personId === personId);
    if (existing) existing.role = role;
    else this.rows.push({ projectId, personId, role });
  }
  async remove(projectId: string, personId: string) {
    this.rows = this.rows.filter((m) => !(m.projectId === projectId && m.personId === personId));
  }
  async setRole(projectId: string, personId: string, role: MemberRole) {
    const m = this.rows.find((x) => x.projectId === projectId && x.personId === personId);
    if (m) m.role = role;
  }
}

class InMemoryMilestones extends MilestoneRepository {
  rows: MilestoneModel[] = [];
  async findByProjects(ids: readonly string[]) {
    return this.rows.filter((m) => ids.includes(m.projectId)).map((m) => ({ ...m }));
  }
  async findById(id: string) {
    const m = this.rows.find((x) => x.id === id);
    return m ? { ...m } : null;
  }
  async projectIdsOfAssignee(personId: string) {
    return [...new Set(this.rows.filter((m) => m.assigneePersonId === personId).map((m) => m.projectId))];
  }
  async create(data: NewMilestone) {
    const row: MilestoneModel = { ...data, id: nextId('ms'), status: 'PENDING', completedOn: null, createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: MilestonePatch) {
    const row = this.rows.find((m) => m.id === id)!;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return { ...row };
  }
  async delete(id: string) {
    this.rows = this.rows.filter((m) => m.id !== id);
  }
}

class InMemoryAttachments extends ProjectAttachmentRepository {
  rows: ProjectAttachmentModel[] = [];
  async findByProject(projectId: string) {
    return this.rows.filter((a) => a.projectId === projectId).map((a) => ({ ...a }));
  }
  async findById(id: string) {
    const a = this.rows.find((x) => x.id === id);
    return a ? { ...a } : null;
  }
  async create(data: NewProjectAttachment) {
    const row: ProjectAttachmentModel = { ...data, id: nextId('at'), createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
}

export class FakeOrg extends ProjectOrgDirectory {
  /** Cấp dưới (mọi cấp) của mỗi người. */
  team = new Map<string, string[]>([
    [PEOPLE.boss, [PEOPLE.deputy, PEOPLE.head, PEOPLE.staff, PEOPLE.other]],
    [PEOPLE.deputy, [PEOPLE.head, PEOPLE.staff, PEOPLE.other]],
    [PEOPLE.head, [PEOPLE.staff, PEOPLE.other]],
  ]);
  inactive = new Set<string>();
  async subordinateHolders(personId: string) {
    return this.team.get(personId) ?? [];
  }
  async activePersonIds(ids: readonly string[]) {
    return new Set(ids.filter((i) => !this.inactive.has(i) && Object.values(PEOPLE).includes(i as never)));
  }
  async unitOf(personId: string) {
    return personId === PEOPLE.boss || personId === PEOPLE.deputy ? 'u-ban' : 'u-phong';
  }
  async lookup() {
    return {
      persons: new Map(Object.entries(PEOPLE).map(([k, id]) => [id, { fullName: `Cán bộ ${k}` }])),
      units: new Map([['u-ban', { name: 'Lãnh đạo Ban' }], ['u-phong', { name: 'Phòng thử' }]]),
    };
  }
}

export class FakeWork extends ProjectWorkDirectory {
  /** Việc giả: mã việc → đề án đang gắn (null nếu chưa gắn) và người giao. */
  items = new Map<string, { projectId: string | null; assigner: string; assignee: string; title: string; cancelled?: boolean }>();
  async linkedWork(projectId: string): Promise<LinkedWork[]> {
    return [...this.items.entries()]
      .filter(([, v]) => v.projectId === projectId)
      .map(([assignmentId, v]) => ({ assignmentId, title: v.title, taskTitle: 'Nhiệm vụ', assigneePersonId: v.assignee, dueDate: '2026-11-01', state: 'IN_PROGRESS', plannedQuantity: 1, confirmedQuantity: 0, lateCount: 0, reworkCount: 0 }));
  }
  async countByProject(ids: readonly string[]) {
    const m = new Map<string, number>();
    for (const v of this.items.values()) if (v.projectId && ids.includes(v.projectId)) m.set(v.projectId, (m.get(v.projectId) ?? 0) + 1);
    return m;
  }
  async link(actor: Actor, assignmentId: string, projectId: string | null) {
    const v = this.items.get(assignmentId);
    if (!v) throw new Error('không có việc');
    if (v.assigner !== actor.id) throw new Error('không phải người giao');
    if (projectId !== null && v.projectId !== null && v.projectId !== projectId) throw new Error('đã thuộc đề án khác');
    v.projectId = projectId;
    return { title: v.title, assigneePersonId: v.assignee };
  }
  async candidates(actor: Actor): Promise<LinkedWork[]> {
    return [...this.items.entries()]
      .filter(([, v]) => v.assigner === actor.id && v.projectId === null)
      .map(([assignmentId, v]) => ({ assignmentId, title: v.title, taskTitle: 'Nhiệm vụ', assigneePersonId: v.assignee, dueDate: '2026-11-01', state: 'IN_PROGRESS', plannedQuantity: 1, confirmedQuantity: 0, lateCount: 0, reworkCount: 0 }));
  }
}

class FakeStorage extends FileStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    const d = this.files.get(key);
    if (!d) throw new Error('không có tệp');
    return d;
  }
}

export async function buildProject() {
  const clock = new FakeClock();
  const audit: { action: string; details?: Record<string, unknown> }[] = [];
  const repos = { projects: new InMemoryProjects(), members: new InMemoryMembers(), milestones: new InMemoryMilestones(), attachments: new InMemoryAttachments() };
  const org = new FakeOrg();
  const work = new FakeWork();
  const storage = new FakeStorage();
  const notifier = new FakeNotifier();
  const moduleRef = await Test.createTestingModule({
    providers: [
      ProjectService,
      { provide: Clock, useValue: clock },
      { provide: ProjectRepository, useValue: repos.projects },
      { provide: MemberRepository, useValue: repos.members },
      { provide: MilestoneRepository, useValue: repos.milestones },
      { provide: ProjectAttachmentRepository, useValue: repos.attachments },
      { provide: ProjectOrgDirectory, useValue: org },
      { provide: ProjectWorkDirectory, useValue: work },
      { provide: FileStorage, useValue: storage },
      { provide: AuditService, useValue: { record: async (e: { action: string; details?: Record<string, unknown> }) => void audit.push(e) } },
      { provide: Notifier, useValue: notifier },
    ],
  }).compile();
  return { service: moduleRef.get(ProjectService), clock, audit, repos, org, work, storage, notifier };
}

export type Harness = Awaited<ReturnType<typeof buildProject>>;

/** Đề án do `head` lập (chủ trì: head), kỳ 2026-10-01 đến 2026-12-31. */
export function seedProject(h: Harness, who: Who = 'head', over: Partial<Parameters<ProjectService['create']>[1]> = {}) {
  return h.service.create(actorOf(who), { kind: 'DE_AN', title: 'Đề án thử nghiệm', startDate: '2026-10-01', endDate: '2026-12-31', ...over });
}

/** Đề án đã có mốc, đã trình và đã duyệt (ACTIVE). */
export async function seedActive(h: Harness, over: Partial<Parameters<ProjectService['create']>[1]> = {}) {
  const p = await seedProject(h, 'head', over);
  await h.service.addMember(actorOf('head'), p.id, PEOPLE.staff);
  await h.service.addMilestone(actorOf('head'), p.id, { title: 'Dự thảo đề án', dueDate: '2026-10-20', weight: 2, assigneePersonId: PEOPLE.staff });
  await h.service.addMilestone(actorOf('head'), p.id, { title: 'Trình Ban Thường vụ', dueDate: '2026-12-15' });
  await h.service.submit(actorOf('head'), p.id);
  return h.service.approve(actorOf('boss'), p.id, CAPS.boss);
}
