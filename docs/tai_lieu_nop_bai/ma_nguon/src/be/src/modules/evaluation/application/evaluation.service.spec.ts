import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  actorOf,
  buildEvaluation,
  documentCriteria,
  marksFor,
  PEOPLE,
  seedPlanned,
  seedReviewed,
  seedSelfSubmitted,
} from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';
import { LEADER_SET, STAFF_SET } from './general-criteria.js';

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
    const evaluation = ((await h.repos.evaluations.findByPersonInPeriod(period.id, PEOPLE.staff))[0])!;
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

  it('số lần được miễn trừ do nguyên nhân khách quan được cộng riêng vào dòng, không lẫn vào số lần bị trừ', async () => {
    const period = await quarter(h);
    h.work.items = [
      work({ assignmentId: 'as-1', plannedQuantity: 10, confirmedQuantity: 10, lateCount: 1, waivedLateCount: 2 }),
      work({ assignmentId: 'as-2', plannedQuantity: 5, confirmedQuantity: 5, waivedReworkCount: 1 }),
    ];
    await h.service.generateFromWork(actorOf('other', 'vanphong'), period.id);
    const evaluation = ((await h.repos.evaluations.findByPersonInPeriod(period.id, PEOPLE.staff))[0])!;
    expect((await h.repos.tasks.findByEvaluation(evaluation.id))[0]).toMatchObject({ lateCount: 1, reworkCount: 0, waivedLateCount: 2, waivedReworkCount: 1 });
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
    expect(await h.repos.evaluations.findByPersonInPeriod(period.id, PEOPLE.other)).toEqual([]);
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
    const evaluation = ((await h.repos.evaluations.findByPersonInPeriod(period.id, PEOPLE.staff))[0])!;
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
    expect((await view()).leadershipSuggestion).toEqual({ unitResult: null, solidarity: null, solidarityReason: null });

    // hồ sơ của trưởng phòng (cấp dưới của phó) đã thẩm định
    const headEval = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.head, positionId: 'pos-head', createdBy: null });
    await h.repos.evaluations.update(headEval.id, { status: 'REVIEWED', rating: 'HOAN_THANH_TOT' });
    expect((await view()).leadershipSuggestion).toMatchObject({ unitResult: 1 });

    await h.repos.evaluations.update(headEval.id, { rating: 'KHONG_HOAN_THANH' });
    expect((await view()).leadershipSuggestion).toMatchObject({ unitResult: 0.5 });
  });

  it('gợi ý D "đoàn kết": 50% khi đơn vị có phản ánh mất đoàn kết trong kỳ chưa bị xác minh là sai, ngoài ra 100% (Điều 15.3.c)', async () => {
    const { evaluation } = await deputyReady();
    h.org.positions.set(PEOPLE.deputy, { positionId: 'pos-deputy', unitId: 'u-ban', level: 2 });
    const view = () => h.service.getEvaluation(actorOf('boss'), evaluation.id, false);
    const add = (over: Record<string, unknown>) => h.complaints.create({ unitId: 'u-ban', periodId: 'x', kind: 'MAT_DOAN_KET', content: 'Mâu thuẫn kéo dài trong đơn vị', source: null, receivedOn: '2026-08-10', createdBy: null, ...over } as never);

    expect((await view()).leadershipSuggestion).toMatchObject({ solidarity: 1, solidarityReason: expect.stringMatching(/không có phản ánh/) });
    await add({ receivedOn: '2026-05-01' }); // ngoài kỳ
    await add({ kind: 'PHAN_ANH' }); // loại khác
    await add({ unitId: 'u-khac' }); // đơn vị khác
    expect((await view()).leadershipSuggestion?.solidarity).toBe(1);

    const issue = await add({});
    expect((await view()).leadershipSuggestion).toMatchObject({ solidarity: 0.5, solidarityReason: expect.stringMatching(/1 phản ánh/) });
    await h.complaints.update(issue.id, { status: 'CLOSED', outcome: 'UNFOUNDED', conclusion: 'Xác minh không đúng sự thật' });
    expect((await view()).leadershipSuggestion?.solidarity).toBe(1);
    await h.complaints.update(issue.id, { outcome: 'SUBSTANTIATED' });
    expect((await view()).leadershipSuggestion?.solidarity).toBe(0.5);
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

describe('EvaluationService: người lao động hỗ trợ, phục vụ (Sổ tay Bộ Nội vụ Chương III, ADR-053)', () => {
  let h: Harness;
  const S = { quality: 100, compliance: 90, efficiency: 80 };
  beforeEach(async () => {
    h = await buildEvaluation();
    h.org.positions.set(PEOPLE.staff, { positionId: 'pos-staff', level: 5, isLeader: false, isSupport: true });
  });

  async function supportPlanned() {
    const period = await h.service.createPeriod(actorOf('head'), { type: 'MONTH', year: 2026, number: 9 });
    const evaluation = await h.service.createEvaluation(actorOf('head'), period.id, PEOPLE.staff);
    return { period, evaluation };
  }

  it('tự đánh giá ba tiêu chí, không cần chỉ tiêu; thiếu hoặc sai khoảng thì bị từ chối', async () => {
    const { evaluation } = await supportPlanned();
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 27 })).rejects.toThrow(/Người lao động cần chấm ba tiêu chí/);
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 27, support: { ...S, quality: 120 } })).rejects.toBeInstanceOf(BadRequestException);
    const submitted = await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 27, support: S, comment: 'Tự đánh giá' });
    expect(submitted).toMatchObject({ status: 'SELF_SUBMITTED', selfGeneralScore: 27, selfSupport: S });
    const view = await h.service.getEvaluation(actorOf('head'), evaluation.id, false);
    // tạm tính theo điểm tự đánh giá: (100 + 90 + 80) / 3 = 90% → 63; tổng 27 + 63 = 90
    expect(view).toMatchObject({ isSupport: true, isLeader: false, preview: { resultScore: 63, totalScore: 90, rating: 'XUAT_SAC', complete: true } });
    expect(view.warnings.join('|')).not.toMatch(/Chưa hoàn thành đủ số lượng/);
  });

  it('người quản lý chấm ba tiêu chí: điểm kết quả = (a + b + c) / 3 × 70, lưu chính sách cùng hồ sơ, có nhật ký', async () => {
    const { evaluation } = await supportPlanned();
    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 27, support: S });
    await expect(h.service.review(actorOf('head'), evaluation.id, { generalScore: 26 })).rejects.toThrow(/Người quản lý cần chấm ba tiêu chí/);
    await expect(h.service.review(actorOf('head'), evaluation.id, { generalScore: 26, support: S, leadership: { unitResult: 1, organizing: 1, solidarity: 1 } })).rejects.toBeInstanceOf(BadRequestException);

    const view = await h.service.review(actorOf('head'), evaluation.id, { generalScore: 26, support: { quality: 90, compliance: 80, efficiency: 70 } });
    // (90 + 80 + 70) / 3 = 80% → 56; tổng 26 + 56 = 82
    expect(view.evaluation).toMatchObject({ status: 'REVIEWED', resultScore: 56, totalScore: 82, rating: 'HOAN_THANH_TOT', support: { quality: 90, compliance: 80, efficiency: 70 }, selfSupport: S });
    expect(view.evaluation.scoringParams).toMatchObject({ policy: 'support-v1-sotay-bnv', rate: 0.8 });
    expect(h.audit.find((a) => a.action === 'evaluation.review')?.details).toMatchObject({ policy: 'support-v1-sotay-bnv', resultScore: 56 });

    await h.service.returnEvaluation(actorOf('deputy'), evaluation.id, 'Chấm lại tiêu chí hiệu quả');
    expect(await h.repos.evaluations.findById(evaluation.id)).toMatchObject({ support: null, selfSupport: S, resultScore: null });
  });

  it('vị trí khác không được gửi ba tiêu chí; vị trí hỗ trợ không có giải thích điểm theo dòng việc', async () => {
    const other = await buildEvaluation(); // chuyên viên thường
    const staffCase = await seedSelfSubmitted(other);
    await expect(
      other.service.review(actorOf('head'), staffCase.evaluation.id, { generalScore: 25, support: S, tasks: [{ taskId: staffCase.t1.id, qualityLevel: 1 }, { taskId: staffCase.t2.id, qualityLevel: 1 }] }),
    ).rejects.toThrow(/chỉ áp dụng cho vị trí hỗ trợ, phục vụ/);

    const { evaluation } = await supportPlanned();
    const insight = await h.service.getInsight(actorOf('head'), evaluation.id, false);
    expect(insight).toMatchObject({ supported: false, reason: expect.stringMatching(/Sổ tay Bộ Nội vụ Chương III/) });
  });
});

describe('EvaluationService: tiêu chí chung chấm theo mục con (ADR-054)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
    await h.criteria.create(documentCriteria('2026-01-01'));
  });

  /** Hồ sơ quý III của staff có hai dòng đã làm đủ, chưa tự chấm. */
  async function staffReady() {
    const { period, evaluation } = await seedPlanned(h);
    const t1 = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 10 });
    await h.service.recordResult(actorOf('staff'), t1.id, { completedQuantity: 10 });
    return { period, evaluation, tasks: [{ taskId: t1.id, qualityLevel: 1 }] };
  }

  it('có bảng áp dụng thì phải chấm từng mục; không nhận một điểm; Không đảm bảo phải có căn cứ', async () => {
    const { evaluation } = await staffReady();
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 25 })).rejects.toThrow(/theo từng mục/);
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, {})).rejects.toThrow(/Cá nhân cần chấm từng mục/);
    const noNote = marksFor('STAFF').map((m) => (m.code === 'I.2' ? { code: 'I.2', ok: false } : m));
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { general: noNote })).rejects.toThrow(/I.2 Không đảm bảo: cần ghi căn cứ/);

    const submitted = await h.service.selfSubmit(actorOf('staff'), evaluation.id, { general: marksFor('STAFF', ['III.1']) });
    expect(submitted).toMatchObject({ selfGeneralScore: 27.5, selfGeneral: { group: 'STAFF', versionId: h.criteria.rows[0].id } });
    const view = await h.service.getEvaluation(actorOf('head'), evaluation.id, false);
    expect(view.generalCriteria).toMatchObject({ group: 'STAFF', effectiveFrom: '2026-01-01' });
    expect(view.generalCriteria?.items).toHaveLength(10);
  });

  it('người thẩm định chấm lại; khác tự chấm phải ghi căn cứ; trả lại hồ sơ thì xóa phần của người thẩm định', async () => {
    const { evaluation, tasks } = await staffReady();
    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { general: marksFor('STAFF') });
    const lower = marksFor('STAFF').map((m) => (m.code === 'I.2' ? { code: 'I.2', ok: false, note: null } : m));
    await expect(h.service.review(actorOf('head'), evaluation.id, { general: lower, tasks })).rejects.toThrow(/I.2 Không đảm bảo/);

    const view = await h.service.review(actorOf('head'), evaluation.id, { general: marksFor('STAFF', ['I.2']), tasks });
    expect(view.evaluation).toMatchObject({ generalScore: 25, resultScore: 70, totalScore: 95, general: { group: 'STAFF' } });
    expect(view.evaluation.general?.items.find((m) => m.code === 'I.2')).toEqual({ code: 'I.2', ok: false, note: 'Hạn chế ở mục I.2' });
    expect(h.audit.find((a) => a.action === 'evaluation.review')?.details).toMatchObject({ generalScore: 25, general: { group: 'STAFF' } });

    await h.service.returnEvaluation(actorOf('deputy'), evaluation.id, 'Xem lại mục kỷ luật');
    expect(await h.repos.evaluations.findById(evaluation.id)).toMatchObject({ general: null, generalScore: null, selfGeneral: { group: 'STAFF' } });
  });

  it('vị trí lãnh đạo chấm theo bảng của 05-HD/TU Phụ lục 03', async () => {
    const period = await h.service.createPeriod(actorOf('boss'), { type: 'QUARTER', year: 2026, number: 3 });
    const evaluation = await h.service.createEvaluation(actorOf('boss'), period.id, PEOPLE.deputy);
    const task = await h.service.addTask(actorOf('boss'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 4 });
    await h.service.recordResult(actorOf('deputy'), task.id, { completedQuantity: 4 });
    await expect(h.service.selfSubmit(actorOf('deputy'), evaluation.id, { general: marksFor('STAFF') })).rejects.toThrow(/I.1 không có/);
    const submitted = await h.service.selfSubmit(actorOf('deputy'), evaluation.id, { general: marksFor('LEADER', ['1.7', '2.2']) });
    expect(submitted).toMatchObject({ selfGeneralScore: 27, selfGeneral: { group: 'LEADER' } });
    expect((await h.service.getEvaluation(actorOf('boss'), evaluation.id, false)).generalCriteria).toMatchObject({ group: 'LEADER', groupLabel: expect.stringMatching(/lãnh đạo/) });
  });

  it('kỳ trước ngày áp dụng của phiên bản đầu tiên vẫn chấm một điểm 0–30 như cũ', async () => {
    h.criteria.rows[0].effectiveFrom = '2027-01-01';
    const { evaluation } = await staffReady();
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { general: marksFor('STAFF') })).rejects.toThrow(/chưa có bảng tiêu chí chung/);
    expect(await h.service.selfSubmit(actorOf('staff'), evaluation.id, { generalScore: 26 })).toMatchObject({ selfGeneralScore: 26, selfGeneral: null });
    expect((await h.service.getEvaluation(actorOf('head'), evaluation.id, false)).generalCriteria).toBeNull();
  });

  it('hồ sơ kỳ sau hiện hạn chế người thẩm định đã nêu ở kỳ cùng loại liền trước', async () => {
    const q2 = await h.service.createPeriod(actorOf('head'), { type: 'QUARTER', year: 2026, number: 2 });
    const prev = await h.service.createEvaluation(actorOf('head'), q2.id, PEOPLE.staff);
    const t = await h.service.addTask(actorOf('head'), prev.id, { catalogItemCode: 'B.009', plannedQuantity: 1 });
    await h.service.recordResult(actorOf('staff'), t.id, { completedQuantity: 1 });
    await h.service.selfSubmit(actorOf('staff'), prev.id, { general: marksFor('STAFF') });
    await h.service.review(actorOf('head'), prev.id, {
      general: marksFor('STAFF').map((m) => (m.code === 'II.3' ? { code: 'II.3', ok: false, note: 'Chậm nộp báo cáo tháng 5' } : m)),
      tasks: [{ taskId: t.id, qualityLevel: 1 }],
      comment: 'Cần chủ động hơn',
    });

    const { evaluation } = await staffReady();
    const view = await h.service.getEvaluation(actorOf('head'), evaluation.id, false);
    expect(view.previous).toEqual({
      periodLabel: '2026-Q2',
      reviewComment: 'Cần chủ động hơn',
      limitations: [{ code: 'II.3', name: 'Tinh thần trách nhiệm trong thực thi công vụ', note: 'Chậm nộp báo cáo tháng 5' }],
    });
  });
});

describe('GeneralCriteriaService: phiên bản bảng tiêu chí chung (ADR-054)', () => {
  let h: Harness;
  const input = (effectiveFrom: string) => ({ effectiveFrom, leader: LEADER_SET, staff: STAFF_SET, note: 'Theo văn bản' });
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('thêm phiên bản: kiểm tra tháng, bảng, trùng ngày; có nhật ký', async () => {
    await expect(h.criteriaService.create(actorOf('head'), input('2026-13'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.criteriaService.create(actorOf('head'), { ...input('2026-11'), staff: { ...STAFF_SET, items: STAFF_SET.items.slice(1) } })).rejects.toThrow(/phải đúng 30/);
    const created = await h.criteriaService.create(actorOf('head'), input('2026-11'));
    expect(created).toMatchObject({ effectiveFrom: '2026-11-01', note: 'Theo văn bản' });
    await expect(h.criteriaService.create(actorOf('head'), input('2026-11'))).rejects.toBeInstanceOf(ConflictException);
    expect(h.audit.find((a) => a.action === 'evaluation.general-criteria.create')?.details).toMatchObject({ effectiveFrom: '2026-11-01', leaderItems: 17, staffItems: 10 });
  });

  it('không áp dụng từ tháng mà kỳ từ đó trở đi đã có người tự chấm; phiên bản đã dùng không xóa được', async () => {
    const first = await h.criteriaService.create(actorOf('head'), input('2026-01'));
    // quý III/2026 đã tự chấm theo phiên bản đầu
    const { evaluation } = await seedPlanned(h);
    const t = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 });
    await h.service.recordResult(actorOf('staff'), t.id, { completedQuantity: 1 });
    await h.service.selfSubmit(actorOf('staff'), evaluation.id, { general: marksFor('STAFF') });
    await expect(h.criteriaService.create(actorOf('head'), input('2026-07'))).rejects.toThrow(/2026-Q3 đã có người tự chấm/);
    const later = await h.criteriaService.create(actorOf('head'), input('2026-10'));

    const list = await h.criteriaService.list();
    expect(list.map((v) => [v.effectiveFrom, v.effectiveTo, v.usedBy])).toEqual([
      ['2026-10-01', null, []],
      ['2026-01-01', '2026-09-30', ['2026-Q3']],
    ]);
    await expect(h.criteriaService.remove(actorOf('head'), first.id)).rejects.toThrow(/không xóa được/);
    await h.criteriaService.remove(actorOf('head'), later.id);
    expect(h.criteria.rows).toHaveLength(1);
    expect(h.audit.some((a) => a.action === 'evaluation.general-criteria.delete')).toBe(true);
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
