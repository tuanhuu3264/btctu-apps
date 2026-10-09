import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  actorOf,
  buildEvaluation,
  PEOPLE,
  seedPlanned,
  seedReviewed,
  seedSelfSubmitted,
} from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('EvaluationService: kỳ đánh giá', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('tạo kỳ quý III, gắn với danh mục đang hiệu lực', async () => {
    const period = await h.service.createPeriod(actorOf('head'), { type: 'QUARTER', year: 2026, number: 3 });
    expect(period).toMatchObject({ label: '2026-Q3', status: 'OPEN', catalogVersionId: 'v-approved', startDate: '2026-07-01', endDate: '2026-09-30' });
  });

  it('từ chối quý IV, kỳ trùng, danh mục chưa phê duyệt, không có danh mục hiệu lực, phiên bản không tồn tại', async () => {
    const actor = actorOf('head');
    await expect(h.service.createPeriod(actor, { type: 'QUARTER', year: 2026, number: 4 })).rejects.toBeInstanceOf(BadRequestException);

    await h.service.createPeriod(actor, { type: 'MONTH', year: 2026, number: 9 });
    await expect(h.service.createPeriod(actor, { type: 'MONTH', year: 2026, number: 9 })).rejects.toBeInstanceOf(ConflictException);

    await expect(
      h.service.createPeriod(actor, { type: 'MONTH', year: 2026, number: 10, catalogVersionId: 'v-draft' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      h.service.createPeriod(actor, { type: 'MONTH', year: 2026, number: 10, catalogVersionId: 'khong-co' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    h.catalog.current = null;
    await expect(h.service.createPeriod(actor, { type: 'MONTH', year: 2026, number: 11 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('kỳ đã đóng thì mọi thao tác trên hồ sơ bị chặn', async () => {
    const { period, evaluation } = await seedPlanned(h);
    await h.service.closePeriod(period.id);
    await h.service.closePeriod(period.id); // đóng lại không lỗi

    await expect(
      h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.other)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.closePeriod('khong-co')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EvaluationService: luồng 4 bước (05-HD/TU)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('đi hết luồng: giao việc, nhập kết quả, tự chấm, thẩm định, phê duyệt; điểm đúng', async () => {
    const { evaluation, t1, t2 } = await seedSelfSubmitted(h);
    expect((await h.repos.evaluations.findById(evaluation.id))!.status).toBe('SELF_SUBMITTED');

    const reviewed = await h.service.review(actorOf('head'), evaluation.id, {
      generalScore: 25,
      comment: 'Hoàn thành tốt',
      tasks: [
        { taskId: t1.id, qualityLevel: 1 },
        { taskId: t2.id, qualityLevel: 2 },
      ],
    });
    expect(reviewed.evaluation).toMatchObject({ status: 'REVIEWED', generalScore: 25, resultScore: 70, totalScore: 95, rating: 'XUAT_SAC', reviewerAccountId: 'acc-head' });
    expect(reviewed.evaluation.scoringParams).toMatchObject({ version: 'v3-nd335' });

    const approved = await h.service.approve(actorOf('deputy'), evaluation.id, 'Đồng ý');
    expect(approved.evaluation).toMatchObject({ status: 'APPROVED', approverAccountId: 'acc-deputy', approveComment: 'Đồng ý', totalScore: 95 });
    expect(approved.preview).toMatchObject({ totalScore: 95, rating: 'XUAT_SAC', complete: true });
    expect(approved.preview.breakdown).toEqual({ quantity: 1, quality: 1, timeliness: 1, leadership: null, kpi: 1 });
  });

  it('xem trước điểm tạm tính trước khi thẩm định: chưa có mức chất lượng thì chưa tính điểm', async () => {
    const { evaluation } = await seedSelfSubmitted(h);
    const view = await h.service.getEvaluation(actorOf('staff'), evaluation.id, false);
    expect(view.preview).toMatchObject({ resultScore: 0, complete: false });
    expect(view.tasks.map((t) => t.name)).toEqual(['Phân loại văn bản', 'Thẩm định văn bản']);
    expect(view.reviewerPersonId).toBe(PEOPLE.head);
    expect(view.approverPersonId).toBe(PEOPLE.deputy);
  });

  it('chỉ người đúng bước, đúng trạng thái mới thao tác được', async () => {
    const { evaluation } = await seedSelfSubmitted(h);
    // chưa thẩm định thì chưa phê duyệt được
    await expect(h.service.approve(actorOf('deputy'), evaluation.id)).rejects.toBeInstanceOf(ConflictException);
    // đã nộp thì không thêm chỉ tiêu, không nộp lại, không ghi kết quả
    await expect(h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 20 })).rejects.toBeInstanceOf(ConflictException);
    const [task] = await h.repos.tasks.findByEvaluation(evaluation.id);
    await expect(h.service.recordResult(actorOf('staff'), task.id, { completedQuantity: 1 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('không tự chấm khi chưa có chỉ tiêu nào', async () => {
    const { evaluation } = await seedPlanned(h);
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 20 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('nhật ký ghi từng bước', async () => {
    await seedReviewed(h);
    await h.service.approve(actorOf('deputy'), h.repos.evaluations.rows[0].id);
    const actions = h.audit.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'evaluation.period.create',
        'evaluation.create',
        'evaluation.task.assign',
        'evaluation.task.result',
        'evaluation.self-submit',
        'evaluation.review',
        'evaluation.approve',
      ]),
    );
    expect(h.audit.find((a) => a.action === 'evaluation.review')?.details).toMatchObject({ totalScore: 95, rating: 'XUAT_SAC', policy: 'v3-nd335' });
  });

  describe('hồ sơ đã phê duyệt', () => {
    it('khóa: không trả lại, không phê duyệt lại, không sửa chỉ tiêu', async () => {
      const { evaluation, t1 } = await seedReviewed(h);
      await h.service.approve(actorOf('deputy'), evaluation.id);

      await expect(h.service.returnEvaluation(actorOf('deputy'), evaluation.id, 'xin trả lại')).rejects.toBeInstanceOf(ConflictException);
      await expect(h.service.approve(actorOf('deputy'), evaluation.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(h.service.recordResult(actorOf('staff'), t1.id, { completedQuantity: 1 })).rejects.toBeInstanceOf(ConflictException);
      await expect(h.service.removeTask(actorOf('head'), t1.id)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

describe('EvaluationService: ai được làm gì (phạm vi theo cây vị trí)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('chỉ cấp trên trực tiếp mới giao mục tiêu (tạo hồ sơ, thêm chỉ tiêu)', async () => {
    const period = await h.service.createPeriod(actorOf('head'), { type: 'QUARTER', year: 2026, number: 3 });
    for (const who of ['deputy', 'boss', 'staff', 'other'] as const) {
      await expect(h.service.createEvaluation(actorOf(who), period.id, PEOPLE.staff)).rejects.toBeInstanceOf(ForbiddenException);
    }
    const evaluation = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    await expect(h.service.addTask(actorOf('deputy'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.addTask(actorOf('staff'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('chỉ chính cán bộ nhập kết quả và tự chấm hồ sơ của mình', async () => {
    const { evaluation } = await seedPlanned(h);
    const task = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 5 });
    for (const who of ['head', 'deputy', 'other'] as const) {
      await expect(h.service.recordResult(actorOf(who), task.id, { completedQuantity: 5 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.selfSubmit(actorOf(who), evaluation.id, { generalScore: 20 })).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('người thẩm định là cấp trên trực tiếp; cán bộ không tự thẩm định, cấp trên xa hơn cũng không thẩm định thay', async () => {
    const { evaluation, t1, t2 } = await seedSelfSubmitted(h);
    const input = { generalScore: 25, tasks: [{ taskId: t1.id, qualityLevel: 1 }, { taskId: t2.id, qualityLevel: 1 }] };
    for (const who of ['staff', 'deputy', 'boss', 'other'] as const) {
      await expect(h.service.review(actorOf(who), evaluation.id, input)).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(h.service.review(actorOf('head'), evaluation.id, input)).resolves.toBeDefined();
  });

  it('người phê duyệt là cấp trên của người thẩm định: người thẩm định không tự phê duyệt, cán bộ không phê duyệt hồ sơ của mình', async () => {
    const { evaluation } = await seedReviewed(h);
    for (const who of ['head', 'staff', 'boss', 'other'] as const) {
      await expect(h.service.approve(actorOf(who), evaluation.id)).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(h.service.approve(actorOf('deputy'), evaluation.id)).resolves.toBeDefined();
  });

  it('khi người thẩm định đã ở trên cùng thì chính họ phê duyệt, nhưng không bao giờ là chủ thể', async () => {
    const period = await h.service.createPeriod(actorOf('boss'), { type: 'QUARTER', year: 2026, number: 3 });
    const evaluation = await h.service.createEvaluation(actorOf('boss'), period.id, PEOPLE.deputy);
    const task = await h.service.addTask(actorOf('boss'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 2 });
    await h.service.recordResult(actorOf('deputy'), task.id, { completedQuantity: 2 });
    await h.service.selfSubmit(actorOf('deputy'), evaluation.id, { generalScore: 28 });
    // Phó Trưởng ban là cán bộ lãnh đạo, quản lý nên người thẩm định phải chấm thêm tiêu chí D.
    await h.service.review(actorOf('boss'), evaluation.id, {
      generalScore: 28,
      leadership: { unitResult: 1, organizing: 1, solidarity: 1 },
      tasks: [{ taskId: task.id, qualityLevel: 1 }],
    });

    await expect(h.service.approve(actorOf('deputy'), evaluation.id)).rejects.toBeInstanceOf(ForbiddenException); // chủ thể
    const approved = await h.service.approve(actorOf('boss'), evaluation.id);
    expect(approved.evaluation).toMatchObject({ status: 'APPROVED', totalScore: 98, rating: 'XUAT_SAC' });
  });

  it('vị trí cấp trên đang trống thì bước đó chuyển lên người giữ vị trí kế tiếp', async () => {
    h.org.chains.set(PEOPLE.staff, [
      { positionId: 'pos-head', level: 3, personId: null },
      h.sup('deputy'),
      h.sup('boss'),
    ]);
    const period = await h.service.createPeriod(actorOf('deputy'), { type: 'MONTH', year: 2026, number: 9 });
    await expect(h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff)).rejects.toBeInstanceOf(ForbiddenException);
    const evaluation = await h.service.createEvaluation(actorOf('deputy'), period.id, PEOPLE.staff);
    const view = await h.service.getEvaluation(actorOf('deputy'), evaluation.id, false);
    expect(view.reviewerPersonId).toBe(PEOPLE.deputy);
    expect(view.approverPersonId).toBe(PEOPLE.boss);
  });

  it('vị trí cấp 1 (không có cấp trên trong hệ thống) không có hồ sơ đánh giá', async () => {
    const period = await h.service.createPeriod(actorOf('boss'), { type: 'QUARTER', year: 2026, number: 3 });
    await expect(h.service.createEvaluation(actorOf('boss'), period.id, PEOPLE.boss)).rejects.toBeInstanceOf(ConflictException);
  });

  it('cán bộ không giữ vị trí nào thì không có hồ sơ', async () => {
    const period = await h.service.createPeriod(actorOf('head'), { type: 'QUARTER', year: 2026, number: 3 });
    await expect(h.service.createEvaluation(actorOf('head'), period.id, 'p-khong-vi-tri')).rejects.toBeInstanceOf(ConflictException);
  });

  it('tài khoản chưa gắn với cán bộ không thao tác được', async () => {
    const { period, evaluation } = await seedPlanned(h);
    const unlinked = actorOf(null);
    await expect(h.service.createEvaluation(unlinked, period.id, PEOPLE.other)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.addTask(unlinked, evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.selfSubmit(unlinked, evaluation.id, { generalScore: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('một cán bộ chỉ có một hồ sơ trong một kỳ', async () => {
    const { period } = await seedPlanned(h);
    await expect(h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('EvaluationService: xem hồ sơ', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('chủ thể và mọi cấp trên trong chuỗi xem được; người khác thì không', async () => {
    const { evaluation } = await seedPlanned(h);
    for (const who of ['staff', 'head', 'deputy', 'boss'] as const) {
      await expect(h.service.getEvaluation(actorOf(who), evaluation.id, false)).resolves.toBeDefined();
    }
    await expect(h.service.getEvaluation(actorOf('other'), evaluation.id, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.getEvaluation(actorOf(null), evaluation.id, false)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('người có quyền xem tất cả xem được kể cả không thuộc chuỗi', async () => {
    const { evaluation } = await seedPlanned(h);
    await expect(h.service.getEvaluation(actorOf('other'), evaluation.id, true)).resolves.toBeDefined();
  });

  it('danh sách chỉ gồm hồ sơ trong phạm vi của người xem', async () => {
    const { period } = await seedPlanned(h); // hồ sơ của staff
    await h.service.createEvaluation(actorOf('deputy'), period.id, PEOPLE.head);
    await expect((await h.service.listEvaluations(actorOf('staff'), period.id, false)).map((e) => e.personId)).toEqual([PEOPLE.staff]);
    await expect((await h.service.listEvaluations(actorOf('head'), period.id, false)).map((e) => e.personId).sort()).toEqual([PEOPLE.head, PEOPLE.staff].sort());
    expect(await h.service.listEvaluations(actorOf('other'), period.id, false)).toEqual([]);
    expect(await h.service.listEvaluations(actorOf('other'), period.id, true)).toHaveLength(2);
    expect(await h.service.listEvaluations(actorOf(null), period.id, false)).toEqual([]);
  });

  it('báo không tìm thấy với hồ sơ và kỳ không tồn tại', async () => {
    await expect(h.service.getEvaluation(actorOf('boss'), 'khong-co', true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.listEvaluations(actorOf('boss'), 'khong-co', true)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EvaluationService: chỉ tiêu', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('kiểm tra công việc: có trong danh mục của kỳ, đã có điểm, không trùng, số lượng hợp lệ', async () => {
    const { evaluation } = await seedPlanned(h);
    const head = actorOf('head');
    await expect(h.service.addTask(head, evaluation.id, { catalogItemCode: 'Z.999', plannedQuantity: 1 })).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.addTask(head, evaluation.id, { catalogItemCode: 'A.007', plannedQuantity: 1 })).rejects.toBeInstanceOf(ConflictException); // chưa có điểm chấm
    for (const q of [0, -1, 1.5, 100_001]) {
      await expect(h.service.addTask(head, evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: q })).rejects.toBeInstanceOf(BadRequestException);
    }
    await h.service.addTask(head, evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 5 });
    await expect(h.service.addTask(head, evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 6 })).rejects.toBeInstanceOf(ConflictException);
  });

  it('gỡ chỉ tiêu khi còn ở bước giao việc', async () => {
    const { evaluation } = await seedPlanned(h);
    const task = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 5 });
    await expect(h.service.removeTask(actorOf('staff'), task.id)).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.removeTask(actorOf('head'), task.id);
    expect(await h.repos.tasks.findByEvaluation(evaluation.id)).toEqual([]);
    await expect(h.service.removeTask(actorOf('head'), task.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('số lượng hoàn thành là số nguyên không âm, cho phép vượt số giao', async () => {
    const { evaluation } = await seedPlanned(h);
    const task = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 5 });
    for (const q of [-1, 2.5, 100_001]) {
      await expect(h.service.recordResult(actorOf('staff'), task.id, { completedQuantity: q })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(h.service.recordResult(actorOf('staff'), task.id, { completedQuantity: 8, evidence: 'vượt mức' })).resolves.toMatchObject({ completedQuantity: 8, evidence: 'vượt mức' });
  });
});

describe('EvaluationService: thẩm định', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('bắt buộc đặt mức chất lượng cho mọi dòng đã có kết quả, và không để lại thay đổi dở dang khi thiếu', async () => {
    const { evaluation, t1, t2 } = await seedSelfSubmitted(h);
    await expect(
      h.service.review(actorOf('head'), evaluation.id, { generalScore: 25, tasks: [{ taskId: t1.id, qualityLevel: 1 }] }),
    ).rejects.toBeInstanceOf(ConflictException); // thiếu t2
    const tasks = await h.repos.tasks.findByEvaluation(evaluation.id);
    expect(tasks.every((t) => t.qualityLevel === null)).toBe(true); // t1 chưa bị ghi
    expect((await h.repos.evaluations.findById(evaluation.id))!.status).toBe('SELF_SUBMITTED');
    expect(t2.id).toBeDefined();
  });

  it('kiểm tra đầu vào: điểm chung 0–30, mức chất lượng 1–3, dòng thuộc hồ sơ', async () => {
    const { evaluation, t1, t2 } = await seedSelfSubmitted(h);
    const tasks = [{ taskId: t1.id, qualityLevel: 1 }, { taskId: t2.id, qualityLevel: 1 }];
    const head = actorOf('head');
    await expect(h.service.review(head, evaluation.id, { generalScore: 31, tasks })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.review(head, evaluation.id, { generalScore: -1, tasks })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.review(head, evaluation.id, { generalScore: 20, tasks: [{ taskId: t1.id, qualityLevel: 4 }, tasks[1]] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.review(head, evaluation.id, { generalScore: 20, tasks: [{ taskId: 'khac', qualityLevel: 1 }, ...tasks] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('người thẩm định có thể sửa số lượng hoàn thành và việc sửa được ghi nhật ký giá trị trước và sau', async () => {
    const { evaluation, t1, t2 } = await seedSelfSubmitted(h);
    const view = await h.service.review(actorOf('head'), evaluation.id, {
      generalScore: 20,
      tasks: [{ taskId: t1.id, qualityLevel: 1, completedQuantity: 5 }, { taskId: t2.id, qualityLevel: 1 }],
    });
    // giao 10×1 + 3×1,333 = 14; đạt 5×1 + 3×1,333 = 9 → a = b = c = 0,6429 (cùng mẫu số là số giao) → KPI = 0,6429 → 45
    expect(view.evaluation.resultScore).toBe(45);
    const entry = h.audit.find((a) => a.action === 'evaluation.review')!;
    expect(JSON.stringify(entry.details)).toContain('"completedQuantity":10');
    expect((entry.details!.taskChanges as unknown[]).length).toBe(2);
  });

  it('dòng chưa làm gì không cần mức chất lượng', async () => {
    const { evaluation } = await seedPlanned(h);
    const task = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 5 });
    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 10 });
    const view = await h.service.review(actorOf('head'), evaluation.id, { generalScore: 10, tasks: [] });
    expect(view.evaluation).toMatchObject({ resultScore: 0, totalScore: 10, rating: 'KHONG_HOAN_THANH' });
    expect(task.id).toBeDefined();
  });
});

describe('EvaluationService: trả lại hồ sơ', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('người thẩm định trả hồ sơ đã tự chấm; cá nhân sửa rồi nộp lại', async () => {
    const { evaluation, t1 } = await seedSelfSubmitted(h);
    await expect(h.service.returnEvaluation(actorOf('head'), evaluation.id, '  ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.returnEvaluation(actorOf('deputy'), evaluation.id, 'không phải người thẩm định')).rejects.toBeInstanceOf(ForbiddenException);

    const returned = await h.service.returnEvaluation(actorOf('head'), evaluation.id, 'Thiếu minh chứng');
    expect(returned).toMatchObject({ status: 'PLANNED', returnReason: 'Thiếu minh chứng' });

    await h.service.recordResult(actorOf('staff'), t1.id, { completedQuantity: 9, evidence: 'bổ sung' });
    const again = await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 27 });
    expect(again).toMatchObject({ status: 'SELF_SUBMITTED', returnReason: null, selfGeneralScore: 27 });
  });

  it('người phê duyệt trả hồ sơ đã thẩm định; kết quả đã tính bị xóa để thẩm định lại', async () => {
    const { evaluation } = await seedReviewed(h);
    await expect(h.service.returnEvaluation(actorOf('head'), evaluation.id, 'người thẩm định không trả ở bước này')).rejects.toBeInstanceOf(ForbiddenException);

    const returned = await h.service.returnEvaluation(actorOf('deputy'), evaluation.id, 'Điểm chung cao quá');
    expect(returned).toMatchObject({
      status: 'PLANNED',
      generalScore: null,
      resultScore: null,
      totalScore: null,
      rating: null,
      scoringParams: null,
      reviewerAccountId: null,
    });
    expect(h.audit.find((a) => a.action === 'evaluation.return')?.details).toMatchObject({ from: 'REVIEWED', reason: 'Điểm chung cao quá' });
  });

  it('chỉ trả được hồ sơ đang chờ thẩm định hoặc chờ phê duyệt', async () => {
    const { evaluation } = await seedPlanned(h);
    await expect(h.service.returnEvaluation(actorOf('head'), evaluation.id, 'chưa nộp mà đòi trả')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('EvaluationService: tạo hồ sơ từ việc được giao (ADR-016)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  const work = (over: Partial<(typeof h.work.items)[number]> = {}) => ({
    assignmentId: 'as-1',
    taskTitle: 'Nhiệm vụ A',
    personId: PEOPLE.staff,
    catalogItemCode: 'B.009',
    plannedQuantity: 10,
    confirmedQuantity: 8,
    lateCount: 0,
    reworkCount: 0,
    evidence: null,
    ...over,
  });
  const quarter = (hh: Harness) => hh.service.createPeriod(actorOf('head'), { type: 'QUARTER', year: 2026, number: 3 });

  it('tạo hồ sơ cho cán bộ có việc, gộp việc cùng mã công việc, ghi nguồn, số lần chậm và chưa đạt', async () => {
    const period = await quarter(h);
    h.work.items = [
      work({ assignmentId: 'as-1', plannedQuantity: 10, confirmedQuantity: 8, lateCount: 1, evidence: 'Biên bản 1' }),
      work({ assignmentId: 'as-2', taskTitle: 'Nhiệm vụ B', plannedQuantity: 5, confirmedQuantity: 5, reworkCount: 2, evidence: 'Biên bản 2' }),
      work({ assignmentId: 'as-3', catalogItemCode: 'A.003', plannedQuantity: 3, confirmedQuantity: 0 }),
    ];

    const result = await h.service.generateFromWork(actorOf('other', 'vanphong'), period.id);

    expect(h.work.asked).toEqual([{ type: 'QUARTER', startDate: '2026-07-01', endDate: '2026-09-30' }]);
    expect(result).toMatchObject({ period: '2026-Q3', created: 1, refreshed: 0, skipped: [], warnings: [] });
    const evaluation = (await h.repos.evaluations.findByPeriodAndPerson(period.id, PEOPLE.staff))!;
    expect(evaluation).toMatchObject({ status: 'PLANNED', createdBy: 'acc-vanphong', positionId: 'pos-staff' });

    const lines = await h.repos.tasks.findByEvaluation(evaluation.id);
    expect(lines.find((t) => t.catalogItemCode === 'B.009')).toMatchObject({
      plannedQuantity: 15,
      completedQuantity: 13,
      lateCount: 1,
      reworkCount: 2,
      evidence: 'Biên bản 1 | Biên bản 2',
      sourceAssignmentIds: ['as-1', 'as-2'],
      sourceTaskTitles: ['Nhiệm vụ A', 'Nhiệm vụ B'],
    });
    expect(lines.find((t) => t.catalogItemCode === 'A.003')).toMatchObject({ plannedQuantity: 3, completedQuantity: 0 });
    expect(h.audit.at(-1)).toMatchObject({ action: 'evaluation.generate', details: { created: 1, refreshed: 0, skipped: 0 } });
  });

  it('làm lại cho kết quả như nhau, làm mới số liệu, bỏ dòng có nguồn đã hết việc, giữ dòng nhập tay', async () => {
    const period = await quarter(h);
    const evaluation = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    const manual = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'A.003', plannedQuantity: 2 });
    h.work.items = [work({ confirmedQuantity: 4 })];
    await h.service.generateFromWork(actorOf('head'), period.id);
    await h.service.generateFromWork(actorOf('head'), period.id);
    let lines = await h.repos.tasks.findByEvaluation(evaluation.id);
    expect(lines).toHaveLength(2);
    expect(lines.find((t) => t.catalogItemCode === 'B.009')).toMatchObject({ completedQuantity: 4 });

    h.work.items = [work({ confirmedQuantity: 9 })];
    const second = await h.service.generateFromWork(actorOf('head'), period.id);
    expect(second).toMatchObject({ created: 0, refreshed: 1 });
    expect((await h.repos.tasks.findByEvaluation(evaluation.id)).find((t) => t.catalogItemCode === 'B.009')).toMatchObject({ completedQuantity: 9 });

    h.work.items = [];
    await h.service.generateFromWork(actorOf('head'), period.id);
    lines = await h.repos.tasks.findByEvaluation(evaluation.id);
    expect(lines.map((t) => t.id)).toEqual([manual.id]);
  });

  it('không ghi đè dòng nhập tay cùng mã công việc, chỉ cảnh báo', async () => {
    const period = await quarter(h);
    const evaluation = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 2 });
    h.work.items = [work()];
    const result = await h.service.generateFromWork(actorOf('head'), period.id);
    expect(result.warnings).toHaveLength(1);
    expect((await h.repos.tasks.findByEvaluation(evaluation.id))[0]).toMatchObject({ plannedQuantity: 2, sourceAssignmentIds: [] });
  });

  it('bỏ qua cán bộ không giữ vị trí, hồ sơ đã qua bước tự chấm, và việc không có trong danh mục của kỳ', async () => {
    const { period, evaluation } = await seedSelfSubmitted(h);
    h.work.items = [
      work({ assignmentId: 'as-1', personId: 'p-khong-vi-tri' }),
      work({ assignmentId: 'as-2', personId: PEOPLE.staff }),
      work({ assignmentId: 'as-3', personId: PEOPLE.other, catalogItemCode: 'Z.999' }),
      work({ assignmentId: 'as-4', personId: PEOPLE.other, catalogItemCode: 'A.007' }),
    ];
    const result = await h.service.generateFromWork(actorOf('head'), period.id);

    expect(result.created).toBe(0);
    expect(result.skipped.map((s) => s.personId).sort()).toEqual(['p-khong-vi-tri', PEOPLE.staff, PEOPLE.other].sort());
    expect(result.skipped.find((s) => s.personId === PEOPLE.staff)!.reason).toContain('SELF_SUBMITTED');
    expect(result.warnings).toHaveLength(2);
    expect((await h.repos.evaluations.findById(evaluation.id))!.status).toBe('SELF_SUBMITTED'); // không bị đổi
    expect(await h.repos.evaluations.findByPeriodAndPerson(period.id, PEOPLE.other)).toBeNull();
  });

  it('kỳ đã đóng thì không tạo hồ sơ được', async () => {
    const period = await quarter(h);
    await h.service.closePeriod(period.id);
    await expect(h.service.generateFromWork(actorOf('head'), period.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.generateFromWork(actorOf('head'), 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('dòng lấy từ việc: cán bộ không tự sửa kết quả, cấp trên không xóa tay; thẩm định vẫn chạy và chỉnh được số lượng', async () => {
    const period = await quarter(h);
    h.work.items = [work({ plannedQuantity: 10, confirmedQuantity: 8 })];
    await h.service.generateFromWork(actorOf('head'), period.id);
    const evaluation = (await h.repos.evaluations.findByPeriodAndPerson(period.id, PEOPLE.staff))!;
    const [line] = await h.repos.tasks.findByEvaluation(evaluation.id);

    await expect(h.service.recordResult(actorOf('staff'), line.id, { completedQuantity: 10 })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.removeTask(actorOf('head'), line.id)).rejects.toBeInstanceOf(ConflictException);

    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 26 });
    const view = await h.service.review(actorOf('head'), evaluation.id, { generalScore: 25, tasks: [{ taskId: line.id, qualityLevel: 1, completedQuantity: 9 }] });
    expect(view.evaluation.status).toBe('REVIEWED');
    expect(view.tasks[0]).toMatchObject({ completedQuantity: 9, qualityLevel: 1, lateCount: 0 });
    await h.service.approve(actorOf('deputy'), evaluation.id);
    expect((await h.repos.evaluations.findById(evaluation.id))!.status).toBe('APPROVED');
  });
});

describe('EvaluationService: tiêu chí lãnh đạo, chỉ đạo (D) của cán bộ lãnh đạo, quản lý', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  /** boss giao việc cho deputy (cấp 2, lãnh đạo), deputy làm đủ và tự chấm. */
  async function deputyReady() {
    const period = await h.service.createPeriod(actorOf('boss'), { type: 'QUARTER', year: 2026, number: 3 });
    const evaluation = await h.service.createEvaluation(actorOf('boss'), period.id, PEOPLE.deputy);
    const task = await h.service.addTask(actorOf('boss'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 4 });
    await h.service.recordResult(actorOf('deputy'), task.id, { completedQuantity: 4 });
    await h.service.selfSubmit(actorOf('deputy'), evaluation.id, { generalScore: 25 });
    return { period, evaluation, task };
  }

  it('cán bộ lãnh đạo phải được chấm D; người không lãnh đạo thì không được gửi D', async () => {
    const { evaluation, task } = await deputyReady();
    const tasks = [{ taskId: task.id, qualityLevel: 1 }];
    await expect(h.service.review(actorOf('boss'), evaluation.id, { generalScore: 25, tasks })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.review(actorOf('boss'), evaluation.id, { generalScore: 25, tasks, leadership: { unitResult: 0.7, organizing: 1, solidarity: 1 } }),
    ).rejects.toBeInstanceOf(BadRequestException); // chỉ 100% hoặc 50%

    const other = await buildEvaluation(); // bộ dữ liệu riêng: kỳ 2026-Q3 đã có ở bộ trên
    const staffCase = await seedSelfSubmitted(other);
    await expect(
      other.service.review(actorOf('head'), staffCase.evaluation.id, {
        generalScore: 25,
        leadership: { unitResult: 1, organizing: 1, solidarity: 1 },
        tasks: [{ taskId: staffCase.t1.id, qualityLevel: 1 }, { taskId: staffCase.t2.id, qualityLevel: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('điểm có d, đ, e: KPI = (a + b + c + d + đ + e) / 6, lưu các thành phần cùng hồ sơ để tái lập', async () => {
    const { evaluation, task } = await deputyReady();
    const view = await h.service.review(actorOf('boss'), evaluation.id, {
      generalScore: 25,
      leadership: { unitResult: 1, organizing: 1, solidarity: 0.5 },
      tasks: [{ taskId: task.id, qualityLevel: 1 }],
    });
    // a = b = c = 1; d = đ = 1, e = 0,5 → KPI = 5,5 / 6 = 0,9167 → 64,17; tổng 25 + 64,17 = 89,17
    expect(view.evaluation).toMatchObject({ resultScore: 64.17, totalScore: 89.17, rating: 'HOAN_THANH_TOT', leadership: { unitResult: 1, organizing: 1, solidarity: 0.5 } });
    expect(view.evaluation.scoringParams).toMatchObject({ version: 'v3-nd335', isLeader: true, breakdown: { quantity: 1, quality: 1, timeliness: 1, leadership: 0.8333, kpi: 0.9167 } });
    expect(view.preview.breakdown).toMatchObject({ leadership: 0.8333 });
    expect(view.isLeader).toBe(true);
  });

  it('trả lại hồ sơ thì xóa điểm D đã chấm', async () => {
    const { evaluation, task } = await deputyReady();
    await h.service.review(actorOf('boss'), evaluation.id, {
      generalScore: 25,
      leadership: { unitResult: 1, organizing: 1, solidarity: 1 },
      tasks: [{ taskId: task.id, qualityLevel: 1 }],
    });
    await h.service.returnEvaluation(actorOf('boss'), evaluation.id, 'Cần chấm lại');
    expect((await h.repos.evaluations.findById(evaluation.id))!.leadership).toBeNull();
  });

  it('gợi ý D "kết quả hoạt động của đơn vị": 100% nếu cấp dưới đều từ hoàn thành, 50% nếu có người không hoàn thành, chưa có dữ liệu thì để trống', async () => {
    const { period, evaluation } = await deputyReady();
    const view = () => h.service.getEvaluation(actorOf('boss'), evaluation.id, false);
    expect((await view()).leadershipSuggestion).toEqual({ unitResult: null });

    // hồ sơ của trưởng phòng (cấp dưới của phó) đã thẩm định
    const headEval = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.head, positionId: 'pos-head', createdBy: null });
    await h.repos.evaluations.update(headEval.id, { status: 'REVIEWED', rating: 'HOAN_THANH_TOT' });
    expect((await view()).leadershipSuggestion).toEqual({ unitResult: 1 });

    await h.repos.evaluations.update(headEval.id, { rating: 'KHONG_HOAN_THANH' });
    expect((await view()).leadershipSuggestion).toEqual({ unitResult: 0.5 });
  });

  it('người không lãnh đạo không có gợi ý D', async () => {
    const { evaluation } = await seedSelfSubmitted(h);
    const view = await h.service.getEvaluation(actorOf('head'), evaluation.id, false);
    expect(view).toMatchObject({ isLeader: false, leadershipSuggestion: null });
  });

  it('cờ lãnh đạo trên vị trí quyết định, không phụ thuộc cấp (ADR-022)', async () => {
    h.org.positions.set(PEOPLE.staff, { positionId: 'pos-staff', level: 5, isLeader: true }); // chuyên viên được đặt là lãnh đạo
    h.org.positions.set(PEOPLE.head, { positionId: 'pos-head', level: 3, isLeader: false }); // trưởng phòng bị tắt cờ
    const staffEval = await seedSelfSubmitted(h);
    expect((await h.service.getEvaluation(actorOf('head'), staffEval.evaluation.id, false)).isLeader).toBe(true);

    const period = await h.repos.periods.findById(staffEval.period.id);
    const headEval = await h.repos.evaluations.create({ periodId: period!.id, personId: PEOPLE.head, positionId: 'pos-head', createdBy: null });
    expect((await h.service.getEvaluation(actorOf('deputy'), headEval.id, false)).isLeader).toBe(false);
  });
});

describe('EvaluationService: cảnh báo chưa hoàn thành đủ số lượng (05-HD/TU mục 8.2)', () => {
  it('cảnh báo khi số lượng đạt dưới 100% nhưng không tự đổi xếp loại', async () => {
    const h = await buildEvaluation();
    const { evaluation } = await seedPlanned(h);
    const task = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 10 });
    await h.service.recordResult(actorOf('staff'), task.id, { completedQuantity: 9 });
    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 30 });
    const reviewed = await h.service.review(actorOf('head'), evaluation.id, { generalScore: 30, tasks: [{ taskId: task.id, qualityLevel: 1 }] });
    expect(reviewed.warnings).toHaveLength(1);
    expect(reviewed.warnings[0]).toContain('mục 8.2');
    expect(reviewed.evaluation.rating).not.toBe('KHONG_HOAN_THANH'); // chưa tự áp dụng
  });

  it('không cảnh báo khi hoàn thành đủ', async () => {
    const h = await buildEvaluation();
    const { evaluation } = await seedReviewed(h);
    expect((await h.service.getEvaluation(actorOf('head'), evaluation.id, false)).warnings).toEqual([]);
  });
});

describe('EvaluationService: phạm vi áp dụng của công việc (ADR-021)', () => {
  const build = async (scope: { unitIds?: string[]; positionIds?: string[] }) => {
    const h = await buildEvaluation();
    h.org.positions.set(PEOPLE.staff, { positionId: 'pos-staff', unitId: 'unit-1', level: 5 });
    const version = h.catalog.versions.get('v-approved')!;
    version.items.set('B.009', { ...version.items.get('B.009')!, ...scope });
    return h;
  };
  const add = async (h: Harness) => {
    const { evaluation } = await seedPlanned(h);
    return h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 });
  };

  it('việc chung thêm được vào hồ sơ', async () => {
    await expect(add(await build({}))).resolves.toBeTruthy();
  });

  it('việc có phạm vi đơn vị: đúng đơn vị thì thêm được, khác đơn vị bị từ chối', async () => {
    await expect(add(await build({ unitIds: ['unit-1'] }))).resolves.toBeTruthy();
    await expect(add(await build({ unitIds: ['unit-2'] }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('đơn vị hoặc vị trí, đạt một là đủ', async () => {
    await expect(add(await build({ unitIds: ['unit-2'], positionIds: ['pos-staff'] }))).resolves.toBeTruthy();
    await expect(add(await build({ positionIds: ['pos-khac'] }))).rejects.toBeInstanceOf(ConflictException);
  });
});
