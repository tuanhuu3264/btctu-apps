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
  HeadedUnitRatingSource,
  OrgDirectory,
  PeriodRepository,
  PeriodWorkSource,
  TaskRepository,
} from '../evaluation.ports.js';
import type { CatalogVersionInfo, HeadedUnitRating, Placement, PeriodWork, PositionInfo, Superior } from '../evaluation.ports.js';
import { LeaveRepository } from '../leave.js';
import type { LeaveMonth } from '../leave.js';
import { UnitComplaintRepository } from '../unit-complaint.js';
import type { NewUnitComplaint, UnitComplaintModel, UnitComplaintPatch } from '../unit-complaint.js';
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
    const row: PeriodModel = { ...data, id: nextId('per'), status: 'OPEN', ratingDeadline: null };
    this.rows.push(row);
    return row;
  }
  async close(id: string) {
    this.rows.find((p) => p.id === id)!.status = 'CLOSED';
  }
  async setDeadline(id: string, date: string | null) {
    this.rows.find((p) => p.id === id)!.ratingDeadline = date;
  }
}

export class InMemoryEvaluations extends EvaluationRepository {
  rows: EvaluationModel[] = [];
  // Trả về bản sao như CSDL thật, để lớp nghiệp vụ không vô tình dựa vào việc đối tượng bị đổi tại chỗ.
  async findById(id: string) {
    const row = this.rows.find((e) => e.id === id);
    return row ? { ...row } : null;
  }
  async findByPeriodPersonPosition(periodId: string, personId: string, positionId: string) {
    const row = this.rows.find((e) => e.periodId === periodId && e.personId === personId && e.positionId === positionId);
    return row ? { ...row } : null;
  }
  async findByPersonInPeriod(periodId: string, personId: string) {
    return this.rows.filter((e) => e.periodId === periodId && e.personId === personId).map((e) => ({ ...e }));
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
      notRatedReason: null,
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
  positions = new Map<string, PositionInfo>();
  chains = new Map<string, Superior[]>();
  /** Vị trí kiêm nhiệm của từng cán bộ (ngoài vị trí chính ở `positions`). */
  concurrent = new Map<string, PositionInfo[]>();
  /** Chuỗi cấp trên riêng cho một vị trí (dùng cho vị trí kiêm nhiệm); không có thì dùng chuỗi của cán bộ. */
  positionChains = new Map<string, Superior[]>();
  async positionOf(personId: string) {
    return this.positions.get(personId) ?? null;
  }
  async positionInfo(positionId: string) {
    const all = [...this.positions.values(), ...[...this.concurrent.values()].flat()];
    return all.find((p) => p.positionId === positionId) ?? null;
  }
  async placementsDuring(personId: string): Promise<Placement[]> {
    const primary = this.positions.get(personId);
    return [...(primary ? [{ ...primary, kind: 'PRIMARY' as const }] : []), ...(this.concurrent.get(personId) ?? []).map((p) => ({ ...p, kind: 'CONCURRENT' as const }))];
  }
  async superiorsOf(personId: string, positionId?: string) {
    return (positionId ? this.positionChains.get(positionId) : undefined) ?? this.chains.get(personId) ?? [];
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

/** Mức đơn vị do cán bộ đứng đầu, đặt tay theo cán bộ (Điều 20.6). */
export class FakeUnitRatings extends HeadedUnitRatingSource {
  byPerson = new Map<string, HeadedUnitRating>();
  async of(personId: string) {
    return this.byPerson.get(personId) ?? null;
  }
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
  const unitRatings = new FakeUnitRatings();
  const leave = new InMemoryLeave();
  const complaints = new InMemoryUnitComplaints();

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
      { provide: HeadedUnitRatingSource, useValue: unitRatings },
      { provide: LeaveRepository, useValue: leave },
      { provide: UnitComplaintRepository, useValue: complaints },
    ],
  }).compile();
  const service = moduleRef.get(EvaluationService);

  return { service, clock, audit, repos, org, catalog, work, sup, notifier, unitRatings, leave, complaints };
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

export class InMemoryUnitComplaints extends UnitComplaintRepository {
  rows: UnitComplaintModel[] = [];
  async create(data: NewUnitComplaint) {
    const row: UnitComplaintModel = {
      ...data,
      id: nextId('cmp'),
      status: 'RECEIVED',
      createdAt: new Date(),
      assignee: null,
      verifyDue: null,
      verifyDirectedBy: null,
      verifyDirectedAt: null,
      outcome: null,
      conclusion: null,
      closedBy: null,
      closedAt: null,
    };
    this.rows.push(row);
    return { ...row };
  }
  async findById(id: string) {
    const row = this.rows.find((c) => c.id === id);
    return row ? { ...row } : null;
  }
  async findByUnitAndPeriod(unitId: string, periodId: string) {
    return this.rows.filter((c) => c.unitId === unitId && c.periodId === periodId).map((c) => ({ ...c }));
  }
  async openCounts(periodId: string) {
    const out = new Map<string, number>();
    for (const c of this.rows) if (c.periodId === periodId && c.status !== 'CLOSED') out.set(c.unitId, (out.get(c.unitId) ?? 0) + 1);
    return out;
  }
  async countSolidarityIssues(unitId: string, from: string, to: string) {
    return this.rows.filter((c) => c.unitId === unitId && c.kind === 'MAT_DOAN_KET' && c.receivedOn >= from && c.receivedOn <= to && !(c.status === 'CLOSED' && c.outcome === 'UNFOUNDED')).length;
  }
  async update(id: string, patch: UnitComplaintPatch) {
    const row = this.rows.find((c) => c.id === id)!;
    Object.assign(row, patch);
    return { ...row };
  }
}

export class InMemoryLeave extends LeaveRepository {
  rows = new Map<string, LeaveMonth[]>();
  async monthsOf(personId: string, year: number) {
    return [...(this.rows.get(`${personId}:${year}`) ?? [])];
  }
  async replace(personId: string, year: number, months: readonly LeaveMonth[]) {
    this.rows.set(`${personId}:${year}`, [...months]);
  }
}
