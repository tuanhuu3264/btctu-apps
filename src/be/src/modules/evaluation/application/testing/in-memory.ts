import { FakeNotifier } from '../../../../common/testing/fake-notifier.js';
import { Notifier } from '../../../../common/notifier.js';
import { Test } from '@nestjs/testing';
import { Clock } from '../../../../common/clock.js';
import { AuditService } from '../../../security/index.js';
import type {
  EvaluationModel,
  EvaluationPatch,
  NewEvaluation,
  NewPeriod,
  NewTask,
  PeriodModel,
  TaskModel,
  TaskPatch,
} from '../evaluation.model.js';
import {
  CatalogDirectory,
  EvaluationRepository,
  OrgDirectory,
  PeriodRepository,
  PeriodWorkSource,
  TaskRepository,
} from '../evaluation.ports.js';
import type { CatalogVersionInfo, PeriodWork, Superior } from '../evaluation.ports.js';
import { EvaluationService } from '../evaluation.service.js';
import type { Actor } from '../evaluation.service.js';

/** Đối tượng giả dùng chung cho test lớp nghiệp vụ của mô-đun evaluation. */

export class FakeClock extends Clock {
  current = new Date('2026-10-03T08:00:00Z');
  now() {
    return new Date(this.current);
  }
}

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

export class InMemoryPeriods extends PeriodRepository {
  rows: PeriodModel[] = [];
  async findById(id: string) {
    return this.rows.find((p) => p.id === id) ?? null;
  }
  async findByLabel(label: string) {
    return this.rows.find((p) => p.label === label) ?? null;
  }
  async findAll() {
    return [...this.rows];
  }
  async create(data: NewPeriod) {
    const row: PeriodModel = { ...data, id: nextId('per'), status: 'OPEN' };
    this.rows.push(row);
    return row;
  }
  async close(id: string) {
    this.rows.find((p) => p.id === id)!.status = 'CLOSED';
  }
}

export class InMemoryEvaluations extends EvaluationRepository {
  rows: EvaluationModel[] = [];
  // Trả về bản sao như CSDL thật, để lớp nghiệp vụ không vô tình dựa vào việc đối tượng bị đổi tại chỗ.
  async findById(id: string) {
    const row = this.rows.find((e) => e.id === id);
    return row ? { ...row } : null;
  }
  async findByPeriodAndPerson(periodId: string, personId: string) {
    const row = this.rows.find((e) => e.periodId === periodId && e.personId === personId);
    return row ? { ...row } : null;
  }
  async findByPeriod(periodId: string) {
    return this.rows.filter((e) => e.periodId === periodId).map((e) => ({ ...e }));
  }
  async create(data: NewEvaluation) {
    const row: EvaluationModel = {
      ...data,
      id: nextId('ev'),
      status: 'PLANNED',
      selfGeneralScore: null,
      selfComment: null,
      selfSubmittedAt: null,
      generalScore: null,
      reviewComment: null,
      reviewerAccountId: null,
      reviewedAt: null,
      approverAccountId: null,
      approvedAt: null,
      approveComment: null,
      returnReason: null,
      resultScore: null,
      totalScore: null,
      rating: null,
      scoringParams: null,
      leadership: null,
    };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: EvaluationPatch) {
    const row = this.rows.find((e) => e.id === id)!;
    Object.assign(row, patch);
    return { ...row };
  }
}

export class InMemoryTasks extends TaskRepository {
  rows: TaskModel[] = [];
  async findById(id: string) {
    const row = this.rows.find((t) => t.id === id);
    return row ? { ...row } : null;
  }
  async findByEvaluation(evaluationId: string) {
    return this.rows.filter((t) => t.evaluationId === evaluationId).map((t) => ({ ...t }));
  }
  async create(data: NewTask) {
    const row: TaskModel = {
      id: nextId('t'),
      evaluationId: data.evaluationId,
      catalogItemCode: data.catalogItemCode,
      plannedQuantity: data.plannedQuantity,
      completedQuantity: data.completedQuantity ?? 0,
      qualityLevel: null,
      evidence: data.evidence ?? null,
      sourceAssignmentIds: data.sourceAssignmentIds ?? [],
      sourceTaskTitles: data.sourceTaskTitles ?? [],
      lateCount: data.lateCount ?? 0,
      reworkCount: data.reworkCount ?? 0,
    };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: TaskPatch) {
    const row = this.rows.find((t) => t.id === id)!;
    Object.assign(row, patch);
    return { ...row };
  }
  async delete(id: string) {
    this.rows = this.rows.filter((t) => t.id !== id);
  }
}

/** Sơ đồ giả: mỗi cán bộ có vị trí và chuỗi cấp trên đặt tay. */
export class FakeOrg extends OrgDirectory {
  positions = new Map<string, { positionId: string; level: number }>();
  chains = new Map<string, Superior[]>();
  async positionOf(personId: string) {
    return this.positions.get(personId) ?? null;
  }
  async superiorsOf(personId: string) {
    return this.chains.get(personId) ?? [];
  }
  async subordinateHolders(personId: string, options: { direct: boolean }) {
    return [...this.chains]
      .filter(([, chain]) => (options.direct ? chain[0]?.personId === personId : chain.some((s) => s.personId === personId)))
      .map(([id]) => id);
  }
}

export class FakeCatalog extends CatalogDirectory {
  current: string | null = 'v-approved';
  versions = new Map<string, CatalogVersionInfo>([
    [
      'v-approved',
      {
        id: 'v-approved',
        status: 'APPROVED',
        items: new Map([
          ['B.009', { name: 'Phân loại văn bản', points: 90, coefficient: 1 }],
          ['A.003', { name: 'Thẩm định văn bản', points: 120, coefficient: 120 / 90 }],
          ['A.007', { name: 'Hội nghị (chưa định mức)', points: null, coefficient: null }],
        ]),
      },
    ],
    ['v-draft', { id: 'v-draft', status: 'DRAFT', items: new Map() }],
  ]);
  async currentApprovedVersionId() {
    return this.current;
  }
  async getVersion(versionId: string) {
    return this.versions.get(versionId) ?? null;
  }
}

/** Nguồn việc giả: đặt tay danh sách việc đã chốt số liệu; ghi lại kỳ được hỏi. */
export class FakeWork extends PeriodWorkSource {
  items: PeriodWork[] = [];
  asked: { type: string; startDate: string; endDate: string }[] = [];
  async collect(period: { type: 'MONTH' | 'QUARTER' | 'YEAR'; startDate: string; endDate: string }) {
    this.asked.push(period);
    return this.items.map((w) => ({ ...w }));
  }
}

/** Bốn người trong một chuỗi quản lý: boss (cấp 1) > deputy (cấp 2) > head (cấp 3) > staff (cấp 5). */
export const PEOPLE = { boss: 'p-boss', deputy: 'p-deputy', head: 'p-head', staff: 'p-staff', other: 'p-other' } as const;

export function actorOf(personKey: keyof typeof PEOPLE | null, account = personKey ?? 'unlinked'): Actor {
  return { id: `acc-${account}`, username: String(account), personId: personKey ? PEOPLE[personKey] : null };
}

export async function buildEvaluation() {
  const clock = new FakeClock();
  const audit: { action: string; details?: Record<string, unknown> }[] = [];
  const repos = {
    periods: new InMemoryPeriods(),
    evaluations: new InMemoryEvaluations(),
    tasks: new InMemoryTasks(),
  };
  const org = new FakeOrg();
  const catalog = new FakeCatalog();
  const work = new FakeWork();

  const level: Record<string, number> = { boss: 1, deputy: 2, head: 3, staff: 5, other: 5 };
  for (const [key, id] of Object.entries(PEOPLE)) org.positions.set(id, { positionId: `pos-${key}`, level: level[key] });
  const sup = (key: keyof typeof PEOPLE): Superior => ({ positionId: `pos-${key}`, level: level[key], personId: PEOPLE[key] });
  org.chains.set(PEOPLE.staff, [sup('head'), sup('deputy'), sup('boss')]);
  org.chains.set(PEOPLE.other, [sup('head'), sup('deputy'), sup('boss')]);
  org.chains.set(PEOPLE.head, [sup('deputy'), sup('boss')]);
  org.chains.set(PEOPLE.deputy, [sup('boss')]);
  org.chains.set(PEOPLE.boss, []);

  const notifier = new FakeNotifier();
  const moduleRef = await Test.createTestingModule({
    providers: [
      EvaluationService,
      { provide: Clock, useValue: clock },
      { provide: PeriodRepository, useValue: repos.periods },
      { provide: EvaluationRepository, useValue: repos.evaluations },
      { provide: TaskRepository, useValue: repos.tasks },
      { provide: OrgDirectory, useValue: org },
      { provide: CatalogDirectory, useValue: catalog },
      { provide: PeriodWorkSource, useValue: work },
      { provide: AuditService, useValue: { record: async (e: { action: string }) => void audit.push(e) } },
      { provide: Notifier, useValue: notifier },
    ],
  }).compile();
  const service = moduleRef.get(EvaluationService);

  return { service, clock, audit, repos, org, catalog, work, sup, notifier };
}

export type Harness = Awaited<ReturnType<typeof buildEvaluation>>;

/** Kỳ quý III/2026 đang mở và hồ sơ của `staff` do `head` giao: điểm xuất phát của hầu hết test. */
export async function seedPlanned(h: Harness) {
  const period = await h.service.createPeriod(actorOf('head'), { type: 'QUARTER', year: 2026, number: 3 });
  const evaluation = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
  return { period, evaluation };
}

/** Thêm hai dòng chỉ tiêu (B.009 x10, A.003 x3), cá nhân nhập kết quả và nộp bài tự chấm. */
export async function seedSelfSubmitted(h: Harness) {
  const { period, evaluation } = await seedPlanned(h);
  const t1 = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 10 });
  const t2 = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'A.003', plannedQuantity: 3 });
  await h.service.recordResult(actorOf('staff'), t1.id, { completedQuantity: 10, evidence: 'Hồ sơ lưu trữ' });
  await h.service.recordResult(actorOf('staff'), t2.id, { completedQuantity: 3 });
  await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 26, comment: 'Tự đánh giá' });
  return { period, evaluation, t1, t2 };
}

/** Người thẩm định chấm: B.009 mức 1, A.003 mức 2, tiêu chí chung 25. Kết quả kỳ vọng: 64 + 25 = 89. */
export async function seedReviewed(h: Harness) {
  const seeded = await seedSelfSubmitted(h);
  const view = await h.service.review(actorOf('head'), seeded.evaluation.id, {
    generalScore: 25,
    comment: 'Hoàn thành tốt',
    tasks: [
      { taskId: seeded.t1.id, qualityLevel: 1 },
      { taskId: seeded.t2.id, qualityLevel: 2 },
    ],
  });
  return { ...seeded, view };
}
