import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { actorOf, buildEvaluation, PEOPLE } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

/** `staff` giữ vị trí chính pos-staff (cấp 5) và kiêm nhiệm pos-lead (cấp 4, lãnh đạo) dưới quyền `other` > `deputy`. */
async function withConcurrent(): Promise<Harness> {
  const h = await buildEvaluation();
  h.org.concurrent.set(PEOPLE.staff, [{ positionId: 'pos-lead', unitId: 'unit-2', level: 4, isLeader: true }]);
  h.org.positionChains.set('pos-lead', [
    { positionId: 'pos-other', level: 3, personId: PEOPLE.other },
    { positionId: 'pos-deputy', level: 2, personId: PEOPLE.deputy },
  ]);
  return h;
}

const quarter = (h: Harness) => h.service.createPeriod(actorOf('head'), { type: 'QUARTER', year: 2026, number: 3 });

describe('EvaluationService: kiêm nhiệm, mỗi vị trí một phiếu riêng (ADR-047)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await withConcurrent();
  });

  it('cán bộ kiêm nhiệm có hai phiếu cùng kỳ, mỗi phiếu do cấp trên của đúng vị trí đó giao', async () => {
    const period = await quarter(h);
    const main = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    const extra = await h.service.createEvaluation(actorOf('other'), period.id, PEOPLE.staff, 'pos-lead');

    expect(main.positionId).toBe('pos-staff');
    expect(extra.positionId).toBe('pos-lead');
    expect(await h.repos.evaluations.findByPersonInPeriod(period.id, PEOPLE.staff)).toHaveLength(2);
    expect(h.audit.filter((a) => a.action === 'evaluation.create').map((a) => a.details)).toEqual([
      expect.objectContaining({ positionId: 'pos-staff' }),
      expect.objectContaining({ positionId: 'pos-lead' }),
    ]);
  });

  it('cấp trên của vị trí chính không giao được phiếu của vị trí kiêm nhiệm, và ngược lại', async () => {
    const period = await quarter(h);
    await expect(h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff, 'pos-lead')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.createEvaluation(actorOf('other'), period.id, PEOPLE.staff)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('mỗi vị trí chỉ một phiếu trong kỳ; vị trí cán bộ không giữ thì từ chối', async () => {
    const period = await quarter(h);
    await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    await h.service.createEvaluation(actorOf('other'), period.id, PEOPLE.staff, 'pos-lead');
    await expect(h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.createEvaluation(actorOf('other'), period.id, PEOPLE.staff, 'pos-lead')).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff, 'pos-khong-giu')).rejects.toBeInstanceOf(ConflictException);
  });

  it('thẩm quyền, công thức tính và người xem được tính riêng theo từng phiếu', async () => {
    const period = await quarter(h);
    const main = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    const extra = await h.service.createEvaluation(actorOf('other'), period.id, PEOPLE.staff, 'pos-lead');

    const mainView = await h.service.getEvaluation(actorOf('staff'), main.id, false);
    const extraView = await h.service.getEvaluation(actorOf('staff'), extra.id, false);
    expect(mainView).toMatchObject({ reviewerPersonId: PEOPLE.head, approverPersonId: PEOPLE.deputy, isLeader: false });
    expect(extraView).toMatchObject({ reviewerPersonId: PEOPLE.other, approverPersonId: PEOPLE.deputy, isLeader: true });

    // Cấp trên của vị trí chính không xem được phiếu của vị trí kiêm nhiệm.
    await expect(h.service.getEvaluation(actorOf('head'), extra.id, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.getEvaluation(actorOf('other'), main.id, false)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.listEvaluations(actorOf('staff'), period.id, false)).map((e) => e.id).sort()).toEqual([main.id, extra.id].sort());
    expect((await h.service.listEvaluations(actorOf('head'), period.id, false)).map((e) => e.id)).toEqual([main.id]);
    expect((await h.service.listEvaluations(actorOf('other'), period.id, false)).map((e) => e.id)).toEqual([extra.id]);
  });

  it('phiếu vị trí lãnh đạo bắt buộc chấm tiêu chí D, phiếu vị trí thường không được chấm', async () => {
    const period = await quarter(h);
    const main = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    const extra = await h.service.createEvaluation(actorOf('other'), period.id, PEOPLE.staff, 'pos-lead');
    for (const [actor, evaluation] of [[actorOf('head'), main], [actorOf('other'), extra]] as const) {
      const task = await h.service.addTask(actor, evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 2 });
      await h.service.recordResult(actorOf('staff'), task.id, { completedQuantity: 2 });
      await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 25 });
    }
    const [mainTask] = await h.repos.tasks.findByEvaluation(main.id);
    const [extraTask] = await h.repos.tasks.findByEvaluation(extra.id);

    await expect(h.service.review(actorOf('other'), extra.id, { generalScore: 25, tasks: [{ taskId: extraTask.id, qualityLevel: 1 }] })).rejects.toBeInstanceOf(BadRequestException);
    const leadView = await h.service.review(actorOf('other'), extra.id, {
      generalScore: 25,
      tasks: [{ taskId: extraTask.id, qualityLevel: 1 }],
      leadership: { unitResult: 1, organizing: 1, solidarity: 1 },
    });
    expect(leadView.evaluation).toMatchObject({ status: 'REVIEWED', totalScore: 95 });
    await expect(
      h.service.review(actorOf('head'), main.id, { generalScore: 25, tasks: [{ taskId: mainTask.id, qualityLevel: 1 }], leadership: { unitResult: 1, organizing: 1, solidarity: 1 } }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const mainReviewed = await h.service.review(actorOf('head'), main.id, { generalScore: 20, tasks: [{ taskId: mainTask.id, qualityLevel: 2 }] });
    // Hai phiếu không ảnh hưởng điểm của nhau.
    expect(mainReviewed.evaluation.totalScore).not.toBe(leadView.evaluation.totalScore);
    expect((await h.repos.evaluations.findById(extra.id))!.totalScore).toBe(95);
  });

  it('tạo hồ sơ từ việc: việc ghi vị trí nào vào phiếu vị trí đó, việc không ghi vị trí vào vị trí chính', async () => {
    const period = await quarter(h);
    const base = { taskTitle: 'NV', personId: PEOPLE.staff, plannedQuantity: 4, confirmedQuantity: 4, lateCount: 0, reworkCount: 0, evidence: null };
    h.work.items = [
      { ...base, assignmentId: 'as-main', catalogItemCode: 'B.009', positionId: null },
      { ...base, assignmentId: 'as-old', catalogItemCode: 'A.003', positionId: 'pos-staff' },
      { ...base, assignmentId: 'as-lead', catalogItemCode: 'B.009', positionId: 'pos-lead', plannedQuantity: 9, confirmedQuantity: 7 },
    ];

    const result = await h.service.generateFromWork(actorOf('other', 'vanphong'), period.id);

    expect(result).toMatchObject({ created: 2, skipped: [] });
    expect(result.evaluations.map((e) => e.positionId).sort()).toEqual(['pos-lead', 'pos-staff']);
    const files = await h.repos.evaluations.findByPersonInPeriod(period.id, PEOPLE.staff);
    const main = files.find((e) => e.positionId === 'pos-staff')!;
    const extra = files.find((e) => e.positionId === 'pos-lead')!;
    expect((await h.repos.tasks.findByEvaluation(main.id)).map((t) => t.catalogItemCode).sort()).toEqual(['A.003', 'B.009']);
    expect(await h.repos.tasks.findByEvaluation(extra.id)).toEqual([expect.objectContaining({ catalogItemCode: 'B.009', plannedQuantity: 9, completedQuantity: 7, sourceAssignmentIds: ['as-lead'] })]);

    // Làm lại: không sinh trùng; việc ở vị trí kiêm hết thì dòng của phiếu kiêm được dọn, phiếu chính giữ nguyên.
    h.work.items = h.work.items.filter((w) => w.assignmentId !== 'as-lead');
    const again = await h.service.generateFromWork(actorOf('other', 'vanphong'), period.id);
    expect(again).toMatchObject({ created: 0, refreshed: 1 });
    expect(await h.repos.tasks.findByEvaluation(extra.id)).toEqual([]);
    expect(await h.repos.tasks.findByEvaluation(main.id)).toHaveLength(2);
  });

  it('phạm vi áp dụng công việc xét theo đơn vị, vị trí của chính phiếu', async () => {
    const period = await quarter(h);
    const extra = await h.service.createEvaluation(actorOf('other'), period.id, PEOPLE.staff, 'pos-lead');
    const info = await h.org.positionInfo('pos-lead');
    expect(info).toMatchObject({ unitId: 'unit-2', isLeader: true });
    // Công việc chỉ áp dụng cho đơn vị unit-1: phiếu của vị trí ở unit-2 không giao được.
    h.catalog.versions.get('v-approved')!.items.set('B.009', { name: 'Phân loại văn bản', points: 90, coefficient: 1, unitIds: ['unit-1'], positionIds: [] });
    await expect(h.service.addTask(actorOf('other'), extra.id, { catalogItemCode: 'B.009', plannedQuantity: 1 })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('EvaluationService: điểm năm tính riêng theo vị trí (ADR-047)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await withConcurrent();
  });

  async function month(m: number, positionId: string, general: number, result: number) {
    const period = (await h.repos.periods.findAll()).find((p) => p.type === 'MONTH' && p.number === m) ?? (await h.service.createPeriod(actorOf('head'), { type: 'MONTH', year: 2026, number: m }));
    const file = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.staff, positionId, createdBy: null });
    await h.repos.evaluations.update(file.id, { status: 'APPROVED', generalScore: general, resultScore: result, totalScore: general + result, rating: 'HOAN_THANH_TOT' });
  }

  it('phiếu năm của mỗi vị trí chỉ lấy tháng của vị trí đó; vị trí kiêm không mượn tháng của vị trí chính', async () => {
    for (let m = 1; m <= 6; m++) await month(m, 'pos-staff', 24, 60); // vị trí chính: 84
    for (let m = 1; m <= 3; m++) await month(m, 'pos-lead', 28, 68); // vị trí kiêm: 96, chỉ 3 tháng
    const period = await h.service.createPeriod(actorOf('head'), { type: 'YEAR', year: 2026 });
    const main = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
    const extra = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.staff, positionId: 'pos-lead', createdBy: null });

    const mainView = await h.service.getEvaluation(actorOf('staff'), main.id, false);
    expect(mainView.yearAverage).toMatchObject({ enough: true, totalScore: 84 });
    expect(mainView.yearAverage?.months).toHaveLength(6);
    const extraView = await h.service.getEvaluation(actorOf('staff'), extra.id, false);
    expect(extraView.yearAverage).toMatchObject({ enough: false });
    expect(extraView.yearAverage?.months).toHaveLength(3);
    expect(extraView.warnings.join('|')).toMatch(/Mới có 3 tháng/);
  });

  it('vị trí chính vẫn nhận tháng chỉ có một phiếu (chuyển công tác giữa năm) dù khác vị trí', async () => {
    for (let m = 1; m <= 3; m++) await month(m, 'pos-cu', 24, 60); // trước khi chuyển
    for (let m = 4; m <= 6; m++) await month(m, 'pos-staff', 24, 60);
    const period = await h.service.createPeriod(actorOf('head'), { type: 'YEAR', year: 2026 });
    const year = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
    const view = await h.service.getEvaluation(actorOf('staff'), year.id, false);
    expect(view.yearAverage).toMatchObject({ enough: true });
    expect(view.yearAverage?.months).toHaveLength(6);
  });
});
