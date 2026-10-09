import { FakeNotifier } from '../../../../common/testing/fake-notifier.js';
import { Notifier } from '../../../../common/notifier.js';
import { Test } from '@nestjs/testing';
import { Clock } from '../../../../common/clock.js';
import { AccountService, AuditService } from '../../../security/index.js';
import type {
  AssignmentModel,
  AssignmentStatus,
  AttachmentModel,
  CommentModel,
  NewAssignment,
  NewAttachment,
  NewComment,
  NewProgress,
  NewWorkTask,
  ProgressModel,
  ProgressPatch,
  WorkTaskModel,
} from '../tasking.model.js';
import { AssignmentRepository, AttachmentRepository, CatalogDirectory, CommentRepository, ConsultantRepository, FileStorage, OrgDirectory, ProgressRepository, WorkTaskRepository } from '../tasking.ports.js';
import type { CatalogItemInfo } from '../tasking.ports.js';
import { CollaborationService } from '../collaboration.service.js';
import { TaskingService } from '../tasking.service.js';
import type { Actor } from '../tasking.service.js';

/** Đối tượng giả dùng chung cho test lớp nghiệp vụ của mô-đun tasking. */

/** Thời điểm hiện tại dùng chung cho đồng hồ giả và các kho giả, để ngày giao, ngày gửi khớp đồng hồ của test. */
const clockRef = { current: new Date('2026-10-03T08:00:00Z') };

export class FakeClock extends Clock {
  get current(): Date {
    return clockRef.current;
  }
  set current(value: Date) {
    clockRef.current = value;
  }
  now() {
    return new Date(clockRef.current);
  }
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

export class InMemoryAssignments extends AssignmentRepository {
  rows: AssignmentModel[] = [];
  // Trả về bản sao như CSDL thật, để lớp nghiệp vụ không vô tình dựa vào việc đối tượng bị đổi tại chỗ.
  async findById(id: string) {
    const row = this.rows.find((a) => a.id === id);
    return row ? { ...row } : null;
  }
  async findByAssignees(personIds: readonly string[]) {
    return this.rows.filter((a) => personIds.includes(a.assigneePersonId)).map((a) => ({ ...a }));
  }
  async findAll() {
    return this.rows.map((a) => ({ ...a }));
  }
  async findByIds(ids: readonly string[]) {
    return this.rows.filter((a) => ids.includes(a.id)).map((a) => ({ ...a }));
  }
  async findByAssigner(accountId: string) {
    return this.rows.filter((a) => a.assignerAccountId === accountId).map((a) => ({ ...a }));
  }
  async findByApprover(personId: string) {
    return this.rows.filter((a) => a.approverPersonId === personId).map((a) => ({ ...a }));
  }
  async update(id: string, patch: { note?: string | null; approverPersonId?: string | null }) {
    const row = this.rows.find((a) => a.id === id)!;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return { ...row };
  }
  async findOpenDueBetween(from: string, to: string) {
    return this.rows.filter((a) => a.status === 'OPEN' && a.dueDate >= from && a.dueDate <= to).map((a) => ({ ...a }));
  }
  async create(data: NewAssignment) {
    const row: AssignmentModel = { ...data, approverPersonId: data.approverPersonId ?? null, id: nextId('as'), status: 'OPEN', createdAt: new Date(clockRef.current) };
    this.rows.push(row);
    return { ...row };
  }
  async setStatus(id: string, status: AssignmentStatus) {
    const row = this.rows.find((a) => a.id === id)!;
    row.status = status;
    return { ...row };
  }
}

export class InMemoryConsultants extends ConsultantRepository {
  rows: { assignmentId: string; personId: string }[] = [];
  async findByAssignments(ids: readonly string[]) {
    return this.rows.filter((r) => ids.includes(r.assignmentId)).map((r) => ({ ...r }));
  }
  async findAssignmentIds(personId: string) {
    return this.rows.filter((r) => r.personId === personId).map((r) => r.assignmentId);
  }
  async replace(assignmentId: string, personIds: readonly string[]) {
    this.rows = this.rows.filter((r) => r.assignmentId !== assignmentId);
    this.rows.push(...personIds.map((personId) => ({ assignmentId, personId })));
  }
}

export class InMemoryComments extends CommentRepository {
  rows: CommentModel[] = [];
  async findByAssignment(assignmentId: string) {
    return this.rows.filter((c) => c.assignmentId === assignmentId).map((c) => ({ ...c }));
  }
  async findById(id: string) {
    const row = this.rows.find((c) => c.id === id);
    return row ? { ...row } : null;
  }
  async create(data: NewComment) {
    const row: CommentModel = { ...data, id: nextId('cm'), createdAt: new Date(clockRef.current) };
    this.rows.push(row);
    return { ...row };
  }
}

export class InMemoryAttachments extends AttachmentRepository {
  rows: AttachmentModel[] = [];
  async findByAssignment(assignmentId: string) {
    return this.rows.filter((a) => a.assignmentId === assignmentId).map((a) => ({ ...a }));
  }
  async findByAssignments(assignmentIds: readonly string[]) {
    return this.rows.filter((a) => assignmentIds.includes(a.assignmentId)).map((a) => ({ ...a }));
  }
  async findById(id: string) {
    const row = this.rows.find((a) => a.id === id);
    return row ? { ...row } : null;
  }
  async create(data: NewAttachment) {
    const row: AttachmentModel = { ...data, id: nextId('at'), uploadedAt: new Date(clockRef.current) };
    this.rows.push(row);
    return { ...row };
  }
}

export class InMemoryStorage extends FileStorage {
  files = new Map<string, { data: Buffer; contentType: string }>();
  async put(key: string, data: Buffer, contentType: string) {
    this.files.set(key, { data, contentType });
  }
  async get(key: string) {
    const f = this.files.get(key);
    if (!f) throw new Error(`Không có tệp ${key}`);
    return f.data;
  }
}

export class InMemoryWorkTasks extends WorkTaskRepository {
  rows: WorkTaskModel[] = [];
  async findById(id: string) {
    const row = this.rows.find((t) => t.id === id);
    return row ? { ...row } : null;
  }
  async findByIds(ids: readonly string[]) {
    return this.rows.filter((t) => ids.includes(t.id)).map((t) => ({ ...t }));
  }
  async findByAssignees(personIds: readonly string[]) {
    return this.rows.filter((t) => personIds.includes(t.assigneePersonId)).map((t) => ({ ...t }));
  }
  async findAll() {
    return this.rows.map((t) => ({ ...t }));
  }
  async findByAssigneeAndTitle(personId: string, title: string) {
    const row = this.rows.find((t) => t.assigneePersonId === personId && t.title.toLowerCase() === title.toLowerCase());
    return row ? { ...row } : null;
  }
  async create(data: NewWorkTask) {
    const row: WorkTaskModel = { ...data, id: nextId('tk') };
    this.rows.push(row);
    return { ...row };
  }
}

export class InMemoryProgress extends ProgressRepository {
  rows: ProgressModel[] = [];
  async findById(id: string) {
    const row = this.rows.find((p) => p.id === id);
    return row ? { ...row } : null;
  }
  async findByAssignments(assignmentIds: readonly string[]) {
    return this.rows.filter((p) => assignmentIds.includes(p.assignmentId)).map((p) => ({ ...p }));
  }
  async create(data: NewProgress) {
    const row: ProgressModel = { ...data, id: nextId('pg'), status: 'REPORTED', decidedBy: null, decidedAt: null, decisionNote: null, majorError: true };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: ProgressPatch) {
    const row = this.rows.find((p) => p.id === id)!;
    Object.assign(row, patch);
    return { ...row };
  }
}

/** Sơ đồ giả: chuỗi cấp trên đặt tay; cấp dưới suy ra từ các chuỗi đó. */
export class FakeOrg extends OrgDirectory {
  chains = new Map<string, string[]>();
  async superiorHolders(personId: string) {
    return this.chains.get(personId) ?? [];
  }
  /** Cán bộ ngừng quản lý: test đặt vào đây. */
  inactive = new Set<string>();
  async activePersonIds(personIds: readonly string[]) {
    return new Set(personIds.filter((id) => !this.inactive.has(id) && !id.startsWith('p-ghost')));
  }
  async subordinateHolders(personId: string, options: { direct: boolean }) {
    return [...this.chains].filter(([, chain]) => (options.direct ? chain[0] === personId : chain.includes(personId))).map(([id]) => id);
  }
  placements = new Map<string, { unitId: string; positionId: string }>();
  async placementOf(personId: string) {
    return this.placements.get(personId) ?? null;
  }
}

export class FakeCatalog extends CatalogDirectory {
  approved = true;
  items = new Map<string, CatalogItemInfo>([
    ['B.009', { name: 'Phân loại văn bản', coefficient: 1 }],
    ['A.003', { name: 'Thẩm định văn bản', coefficient: 120 / 90 }],
    ['A.007', { name: 'Hội nghị (chưa định mức)', coefficient: null }],
  ]);
  async currentApproved() {
    return this.approved ? { versionId: 'v-approved', items: this.items } : null;
  }
  async itemsOf(versionId: string) {
    return versionId === 'v-approved' ? this.items : null;
  }
}

/** Chuỗi quản lý: boss > deputy > head > staff; other cùng phòng với staff. */
export const PEOPLE = { boss: 'p-boss', deputy: 'p-deputy', head: 'p-head', staff: 'p-staff', other: 'p-other' } as const;

export function actorOf(personKey: keyof typeof PEOPLE | null, account = personKey ?? 'unlinked'): Actor {
  return { id: `acc-${account}`, username: String(account), personId: personKey ? PEOPLE[personKey] : null };
}

export async function buildTasking() {
  const clock = new FakeClock();
  clock.current = new Date('2026-10-03T08:00:00Z'); // mỗi test bắt đầu từ cùng một thời điểm
  const audit: { action: string; details?: Record<string, unknown> }[] = [];
  const repos = {
    tasks: new InMemoryWorkTasks(),
    assignments: new InMemoryAssignments(),
    progress: new InMemoryProgress(),
    consultants: new InMemoryConsultants(),
    comments: new InMemoryComments(),
    attachments: new InMemoryAttachments(),
  };
  const storage = new InMemoryStorage();
  const org = new FakeOrg();
  const catalog = new FakeCatalog();
  org.chains.set(PEOPLE.staff, [PEOPLE.head, PEOPLE.deputy, PEOPLE.boss]);
  org.chains.set(PEOPLE.other, [PEOPLE.head, PEOPLE.deputy, PEOPLE.boss]);
  org.chains.set(PEOPLE.head, [PEOPLE.deputy, PEOPLE.boss]);
  org.chains.set(PEOPLE.deputy, [PEOPLE.boss]);
  org.chains.set(PEOPLE.boss, []);

  const notifier = new FakeNotifier();
  const moduleRef = await Test.createTestingModule({
    providers: [
      TaskingService,
      CollaborationService,
      { provide: Clock, useValue: clock },
      { provide: AssignmentRepository, useValue: repos.assignments },
      { provide: ProgressRepository, useValue: repos.progress },
      { provide: WorkTaskRepository, useValue: repos.tasks },
      { provide: ConsultantRepository, useValue: repos.consultants },
      { provide: CommentRepository, useValue: repos.comments },
      { provide: AttachmentRepository, useValue: repos.attachments },
      { provide: FileStorage, useValue: storage },
      { provide: OrgDirectory, useValue: org },
      { provide: CatalogDirectory, useValue: catalog },
      { provide: AccountService, useValue: { list: async () => Object.entries(PEOPLE).map(([k, personId]) => ({ id: `acc-${k}`, username: k, status: 'ACTIVE', personId, lockedUntil: null })) } },
      { provide: AuditService, useValue: { record: async (e: { action: string }) => void audit.push(e) } },
      { provide: Notifier, useValue: notifier },
    ],
  }).compile();
  return { service: moduleRef.get(TaskingService), collab: moduleRef.get(CollaborationService), clock, audit, repos, org, catalog, storage, notifier };
}

export type Harness = Awaited<ReturnType<typeof buildTasking>>;

/** Nhiệm vụ "Nhiệm vụ thử" của `assignee` do cấp trên tạo; dùng lại nếu đã có. */
export async function seedTask(h: Harness, creator: keyof typeof PEOPLE = 'head', assignee: string = PEOPLE.staff, title = 'Nhiệm vụ thử') {
  return (await h.repos.tasks.findByAssigneeAndTitle(assignee, title)) ?? h.service.createTask(actorOf(creator), { assigneePersonId: assignee, title });
}

/** `head` giao cho `staff`, trong "Nhiệm vụ thử", việc B.009, số lượng 10, hạn 2026-09-20, chế độ tự động. */
export async function seedAssignment(h: Harness, overrides: Partial<Parameters<TaskingService['assign']>[1]> = {}) {
  const task = await seedTask(h);
  return h.service.assign(actorOf('head'), {
    taskId: task.id,
    catalogItemCode: 'B.009',
    plannedQuantity: 10,
    dueDate: '2026-09-20',
    periodMode: 'AUTO',
    ...overrides,
  });
}
