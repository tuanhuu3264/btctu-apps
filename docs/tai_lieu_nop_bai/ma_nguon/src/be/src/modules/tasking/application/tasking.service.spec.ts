import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { actorOf, buildTasking, PEOPLE, seedAssignment, seedTask } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('TaskingService: giao việc', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  it('cấp trên trực tiếp giao việc; chế độ AUTO tính vào cả ba loại báo cáo; ghi nhật ký', async () => {
    const view = await seedAssignment(h);
    expect(view.assignment).toMatchObject({
      taskId: expect.any(String),
      assigneePersonId: PEOPLE.staff,
      catalogItemCode: 'B.009',
      catalogVersionId: 'v-approved',
      plannedQuantity: 10,
      dueDate: '2026-09-20',
      periodMode: 'AUTO',
      reportKinds: ['MONTH', 'QUARTER', 'YEAR'],
      status: 'OPEN',
      assignerAccountId: 'acc-head',
    });
    expect(view.itemName).toBe('Phân loại văn bản');
    expect(view.task).toEqual({ id: view.assignment.taskId, title: 'Nhiệm vụ thử' });
    expect(view.confirmerPersonId).toBe(PEOPLE.head);
    expect(h.audit.map((a) => a.action)).toEqual(['tasking.task.create', 'tasking.assignment.create']);
  });

  it('chế độ MANUAL ghi đúng các loại báo cáo đã chọn, bỏ trùng', async () => {
    const view = await seedAssignment(h, { periodMode: 'MANUAL', reportKinds: ['QUARTER', 'QUARTER', 'YEAR'] });
    expect(view.assignment.reportKinds).toEqual(['QUARTER', 'YEAR']);
  });

  it('chỉ cấp trên trực tiếp giao được; cấp trên xa hơn, người ngang cấp, tài khoản chưa gắn cán bộ đều bị từ chối', async () => {
    const task = await seedTask(h);
    const input = { taskId: task.id, catalogItemCode: 'B.009', plannedQuantity: 1, dueDate: '2026-09-20', periodMode: 'AUTO' as const };
    await expect(h.service.assign(actorOf('deputy'), input)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.assign(actorOf('other'), input)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.assign(actorOf('staff'), input)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.assign(actorOf(null), input)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('từ chối khi chưa có cấp trên, công việc không có trong danh mục, chưa có điểm chấm, chưa có danh mục hiệu lực', async () => {
    const task = await seedTask(h);
    const input = { taskId: task.id, catalogItemCode: 'B.009', plannedQuantity: 1, dueDate: '2026-09-20', periodMode: 'AUTO' as const };
    await expect(h.service.createTask(actorOf('boss'), { assigneePersonId: PEOPLE.boss, title: 'Nhiệm vụ của Trưởng ban' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.assign(actorOf('head'), { ...input, catalogItemCode: 'Z.999' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.assign(actorOf('head'), { ...input, catalogItemCode: 'A.007' })).rejects.toBeInstanceOf(ConflictException);
    h.catalog.approved = false;
    await expect(h.service.assign(actorOf('head'), input)).rejects.toBeInstanceOf(ConflictException);
  });

  it('từ chối số lượng, hạn, chế độ không hợp lệ', async () => {
    const task = await seedTask(h);
    const base = { taskId: task.id, catalogItemCode: 'B.009', plannedQuantity: 1, dueDate: '2026-09-20', periodMode: 'AUTO' as const };
    const assign = (over: object) => h.service.assign(actorOf('head'), { ...base, ...over });
    for (const plannedQuantity of [0, -1, 1.5, 100_001]) await expect(assign({ plannedQuantity })).rejects.toBeInstanceOf(BadRequestException);
    for (const dueDate of ['2026-9-20', '20/09/2026', '2026-02-30', '']) await expect(assign({ dueDate })).rejects.toBeInstanceOf(BadRequestException);
    await expect(assign({ periodMode: 'MANUAL' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(assign({ periodMode: 'MANUAL', reportKinds: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(assign({ periodMode: 'MANUAL', reportKinds: ['WEEK'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(assign({ periodMode: 'KHAC' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TaskingService: báo cáo hoàn thành và xác nhận', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  it('cán bộ báo cáo, cấp trên xác nhận: số lượng chỉ tính sau khi xác nhận', async () => {
    const { assignment } = await seedAssignment(h);
    const progress = await h.service.report(actorOf('staff'), assignment.id, { quantity: 6, completedOn: '2026-09-10', evidence: ' Biên bản ' });
    expect(progress).toMatchObject({ status: 'REPORTED', quantity: 6, evidence: 'Biên bản' });

    let view = await h.service.get(actorOf('staff'), assignment.id, false);
    expect(view.summary).toMatchObject({ confirmedQuantity: 0, pendingQuantity: 6, done: false });

    await h.service.decide(actorOf('head'), progress.id, { decision: 'CONFIRM' });
    view = await h.service.get(actorOf('staff'), assignment.id, false);
    expect(view.summary).toMatchObject({ confirmedQuantity: 6, pendingQuantity: 0, lateCount: 0, reworkCount: 0, done: false });
    expect(h.audit.map((a) => a.action)).toEqual(['tasking.task.create', 'tasking.assignment.create', 'tasking.progress.report', 'tasking.progress.confirm']);
  });

  it('báo cáo nhiều lần cộng dồn; đủ số lượng thì việc hoàn thành; vượt mục tiêu vẫn ghi nhận', async () => {
    const { assignment } = await seedAssignment(h);
    for (const [quantity, completedOn] of [[6, '2026-09-10'], [6, '2026-09-18']] as const) {
      const p = await h.service.report(actorOf('staff'), assignment.id, { quantity, completedOn });
      await h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' });
    }
    const view = await h.service.get(actorOf('staff'), assignment.id, false);
    expect(view.summary).toMatchObject({ confirmedQuantity: 12, done: true });
  });

  it('báo cáo có ngày hoàn thành sau hạn: khi xác nhận tính là một lần chậm', async () => {
    const { assignment } = await seedAssignment(h);
    const onTime = await h.service.report(actorOf('staff'), assignment.id, { quantity: 4, completedOn: '2026-09-20' });
    const late = await h.service.report(actorOf('staff'), assignment.id, { quantity: 6, completedOn: '2026-09-25' });
    await h.service.decide(actorOf('head'), onTime.id, { decision: 'CONFIRM' });
    await h.service.decide(actorOf('head'), late.id, { decision: 'CONFIRM' });
    expect((await h.service.get(actorOf('head'), assignment.id, false)).summary).toMatchObject({ confirmedQuantity: 10, lateCount: 1 });
  });

  it('từ chối cần lý do và nói rõ sai sót lớn hay không; sai sót lớn là một lần chưa đạt; không cộng vào số lượng', async () => {
    const { assignment } = await seedAssignment(h);
    const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 5, completedOn: '2026-09-10' });
    await expect(h.service.decide(actorOf('head'), p.id, { decision: 'REJECT' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.decide(actorOf('head'), p.id, { decision: 'REJECT', note: ' ab ', majorError: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.decide(actorOf('head'), p.id, { decision: 'REJECT', note: 'Thiếu căn cứ' })).rejects.toBeInstanceOf(BadRequestException); // thiếu majorError

    await h.service.decide(actorOf('head'), p.id, { decision: 'REJECT', note: 'Thiếu căn cứ', majorError: true });
    const view = await h.service.get(actorOf('head'), assignment.id, false);
    expect(view.summary).toMatchObject({ confirmedQuantity: 0, pendingQuantity: 0, reworkCount: 1 });
    expect(view.progress[0]).toMatchObject({ status: 'REJECTED', decisionNote: 'Thiếu căn cứ', decidedBy: 'acc-head' });
  });

  it('từ chối vì lý do nhỏ (không phải sai sót lớn) thì không là một lần chưa đạt, không bị trừ điểm', async () => {
    const { assignment } = await seedAssignment(h);
    const minor = await h.service.report(actorOf('staff'), assignment.id, { quantity: 2, completedOn: '2026-09-10' });
    const major = await h.service.report(actorOf('staff'), assignment.id, { quantity: 2, completedOn: '2026-09-11' });
    await h.service.decide(actorOf('head'), minor.id, { decision: 'REJECT', note: 'Thiếu số liệu', majorError: false });
    expect((await h.service.get(actorOf('head'), assignment.id, false)).summary.reworkCount).toBe(0);

    await h.service.decide(actorOf('head'), major.id, { decision: 'REJECT', note: 'Sai nội dung', majorError: true });
    const view = await h.service.get(actorOf('head'), assignment.id, false);
    expect(view.summary.reworkCount).toBe(1);
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.progress.reject', details: expect.objectContaining({ majorError: true }) });
  });

  it('chỉ chính người được giao báo cáo; chỉ cấp trên trực tiếp xác nhận; mỗi lần báo cáo xử lý một lần', async () => {
    const { assignment } = await seedAssignment(h);
    await expect(h.service.report(actorOf('other'), assignment.id, { quantity: 1, completedOn: '2026-09-10' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.report(actorOf('head'), assignment.id, { quantity: 1, completedOn: '2026-09-10' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.report(actorOf(null), assignment.id, { quantity: 1, completedOn: '2026-09-10' })).rejects.toBeInstanceOf(ForbiddenException);

    const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 1, completedOn: '2026-09-10' });
    await expect(h.service.decide(actorOf('staff'), p.id, { decision: 'CONFIRM' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.decide(actorOf('deputy'), p.id, { decision: 'CONFIRM' })).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' });
    await expect(h.service.decide(actorOf('head'), p.id, { decision: 'REJECT', note: 'đổi ý', majorError: true })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.decide(actorOf('head'), 'khong-co', { decision: 'CONFIRM' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('từ chối số lượng, ngày không hợp lệ hoặc ở tương lai', async () => {
    const { assignment } = await seedAssignment(h);
    const report = (over: object) => h.service.report(actorOf('staff'), assignment.id, { quantity: 1, completedOn: '2026-09-10', ...over });
    for (const quantity of [0, -3, 2.5]) await expect(report({ quantity })).rejects.toBeInstanceOf(BadRequestException);
    await expect(report({ completedOn: '10/09/2026' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(report({ completedOn: '2026-10-04' })).rejects.toBeInstanceOf(BadRequestException); // hôm nay là 2026-10-03
    await expect(report({ completedOn: '2026-10-03' })).resolves.toBeTruthy();
  });

  it('dùng ngày theo giờ Việt Nam: 18:00 UTC ngày 3 đã là ngày 4 ở Việt Nam', async () => {
    const { assignment } = await seedAssignment(h);
    h.clock.current = new Date('2026-10-03T18:00:00Z');
    await expect(h.service.report(actorOf('staff'), assignment.id, { quantity: 1, completedOn: '2026-10-04' })).resolves.toBeTruthy();
  });
});

describe('TaskingService: hủy việc', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  it('cấp trên trực tiếp hủy được khi chưa có kết quả xác nhận; hủy rồi không báo cáo thêm được; hủy lại không lỗi', async () => {
    const { assignment } = await seedAssignment(h);
    await expect(h.service.cancel(actorOf('deputy'), assignment.id)).rejects.toBeInstanceOf(ForbiddenException);
    const cancelled = await h.service.cancel(actorOf('head'), assignment.id);
    expect(cancelled.status).toBe('CANCELLED');
    await h.service.cancel(actorOf('head'), assignment.id);
    await expect(h.service.report(actorOf('staff'), assignment.id, { quantity: 1, completedOn: '2026-09-10' })).rejects.toBeInstanceOf(ConflictException);
    expect(h.audit.filter((a) => a.action === 'tasking.assignment.cancel')).toHaveLength(1);
  });

  it('không hủy được việc đã có kết quả được xác nhận', async () => {
    const { assignment } = await seedAssignment(h);
    const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 1, completedOn: '2026-09-10' });
    await h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' });
    await expect(h.service.cancel(actorOf('head'), assignment.id)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('TaskingService: phạm vi xem', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  it('mine: chỉ việc của mình; team: việc của mọi cấp dưới; all: cần quyền xem toàn bộ', async () => {
    await seedAssignment(h);
    const headTask = await seedTask(h, 'deputy', PEOPLE.head, 'Nhiệm vụ của trưởng phòng');
    await h.service.assign(actorOf('deputy'), { taskId: headTask.id, catalogItemCode: 'A.003', plannedQuantity: 2, dueDate: '2026-09-30', periodMode: 'AUTO' });

    expect(await h.service.list(actorOf('staff'), 'mine', false)).toHaveLength(1);
    expect(await h.service.list(actorOf('head'), 'mine', false)).toHaveLength(1);
    expect(await h.service.list(actorOf('head'), 'team', false)).toHaveLength(1);
    expect(await h.service.list(actorOf('deputy'), 'team', false)).toHaveLength(2); // cả cấp dưới xa
    expect(await h.service.list(actorOf('other'), 'team', false)).toHaveLength(0);
    expect(await h.service.list(actorOf(null), 'mine', false)).toEqual([]);
    await expect(h.service.list(actorOf('head'), 'all', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await h.service.list(actorOf('head'), 'all', true)).toHaveLength(2);
  });

  it('xem một việc: chính cán bộ, các cấp trên, người xem toàn bộ; người khác bị từ chối', async () => {
    const { assignment } = await seedAssignment(h);
    for (const who of ['staff', 'head', 'deputy', 'boss'] as const) {
      await expect(h.service.get(actorOf(who), assignment.id, false)).resolves.toBeTruthy();
    }
    await expect(h.service.get(actorOf('other'), assignment.id, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.get(actorOf(null), assignment.id, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.get(actorOf('other'), assignment.id, true)).resolves.toBeTruthy();
    await expect(h.service.get(actorOf('head'), 'khong-co', false)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TaskingService: thu thập việc theo kỳ', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  const month9 = { type: 'MONTH' as const, startDate: '2026-09-01', endDate: '2026-09-30' };
  const quarter3 = { type: 'QUARTER' as const, startDate: '2026-07-01', endDate: '2026-09-30' };
  const year = { type: 'YEAR' as const, startDate: '2026-01-01', endDate: '2026-12-31' };
  const month10 = { type: 'MONTH' as const, startDate: '2026-10-01', endDate: '2026-10-31' };

  it('AUTO: việc có hạn 20/9 vào tháng 9, quý III và năm, nhưng không vào tháng 10; chỉ đếm một lần ở mỗi loại kỳ', async () => {
    const { assignment } = await seedAssignment(h);
    const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 8, completedOn: '2026-09-18', evidence: 'Biên bản 1' });
    await h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' });

    for (const period of [month9, quarter3, year]) {
      const work = await h.service.collectForPeriod(period);
      expect(work).toHaveLength(1);
      expect(work[0]).toMatchObject({ assignmentId: assignment.id, taskTitle: 'Nhiệm vụ thử', personId: PEOPLE.staff, catalogItemCode: 'B.009', plannedQuantity: 10, confirmedQuantity: 8, evidence: 'Biên bản 1' });
    }
    expect(await h.service.collectForPeriod(month10)).toEqual([]);
  });

  it('MANUAL chỉ vào loại báo cáo đã chọn', async () => {
    await seedAssignment(h, { periodMode: 'MANUAL', reportKinds: ['QUARTER'] });
    expect(await h.service.collectForPeriod(month9)).toHaveLength(0);
    expect(await h.service.collectForPeriod(quarter3)).toHaveLength(1);
    expect(await h.service.collectForPeriod(year)).toHaveLength(0);
  });

  it('việc có hạn trong quý IV chỉ vào kỳ tháng và năm (quý IV không có hồ sơ riêng)', async () => {
    await seedAssignment(h, { dueDate: '2026-10-15' });
    expect(await h.service.collectForPeriod(month10)).toHaveLength(1);
    expect(await h.service.collectForPeriod(year)).toHaveLength(1);
    expect(await h.service.collectForPeriod(quarter3)).toHaveLength(0);
  });

  it('bỏ qua việc đã hủy; hạn đúng ngày đầu và ngày cuối kỳ vẫn thuộc kỳ', async () => {
    const cancelled = await seedAssignment(h);
    await h.service.cancel(actorOf('head'), cancelled.assignment.id);
    await seedAssignment(h, { dueDate: '2026-09-01' });
    await seedAssignment(h, { dueDate: '2026-09-30' });
    await seedAssignment(h, { dueDate: '2026-10-01' });
    expect(await h.service.collectForPeriod(month9)).toHaveLength(2);
  });

  it('báo cáo chưa xác nhận hoặc bị từ chối không được tính; số lần chậm và chưa đạt được chuyển sang', async () => {
    const { assignment } = await seedAssignment(h);
    const pending = await h.service.report(actorOf('staff'), assignment.id, { quantity: 3, completedOn: '2026-09-10' });
    const rejected = await h.service.report(actorOf('staff'), assignment.id, { quantity: 2, completedOn: '2026-09-11' });
    const late = await h.service.report(actorOf('staff'), assignment.id, { quantity: 4, completedOn: '2026-09-27' });
    await h.service.decide(actorOf('head'), rejected.id, { decision: 'REJECT', note: 'Chưa đạt', majorError: true });
    await h.service.decide(actorOf('head'), late.id, { decision: 'CONFIRM' });

    const [work] = await h.service.collectForPeriod(month9);
    expect(work).toMatchObject({ confirmedQuantity: 4, pendingQuantity: 3, reworkCount: 1, lateCount: 1 });
    expect(pending.status).toBe('REPORTED');
  });
});

describe('TaskingService: nhiệm vụ chứa công việc (ADR-018)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  it('cấp trên trực tiếp tạo nhiệm vụ cho cán bộ; tên được chuẩn hóa khoảng trắng; ghi nhật ký', async () => {
    const task = await h.service.createTask(actorOf('head'), { assigneePersonId: PEOPLE.staff, title: '  Rà soát   quy hoạch 2025-2030  ', description: ' Giai đoạn 1 ' });
    expect(task).toMatchObject({ assigneePersonId: PEOPLE.staff, title: 'Rà soát quy hoạch 2025-2030', description: 'Giai đoạn 1', createdByAccountId: 'acc-head' });
    expect(h.audit.map((a) => a.action)).toEqual(['tasking.task.create']);
  });

  it('chỉ cấp trên trực tiếp tạo được nhiệm vụ; tài khoản chưa gắn cán bộ, người ngang cấp, cấp trên xa đều bị từ chối', async () => {
    const input = { assigneePersonId: PEOPLE.staff, title: 'Nhiệm vụ hợp lệ' };
    for (const who of ['staff', 'other', 'deputy', 'boss'] as const) {
      await expect(h.service.createTask(actorOf(who), input)).rejects.toBeInstanceOf(ForbiddenException);
    }
    await expect(h.service.createTask(actorOf(null), input)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('từ chối tên quá ngắn, quá dài và trùng (không phân biệt hoa thường) trong cùng một cán bộ; cán bộ khác được dùng lại tên', async () => {
    const create = (over: object = {}) => h.service.createTask(actorOf('head'), { assigneePersonId: PEOPLE.staff, title: 'Quy hoạch cán bộ', ...over });
    await expect(create({ title: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(create({ title: 'x'.repeat(201) })).rejects.toBeInstanceOf(BadRequestException);
    await create();
    await expect(create({ title: 'QUY HOẠCH cán bộ' })).rejects.toBeInstanceOf(ConflictException);
    await expect(create({ assigneePersonId: PEOPLE.other })).resolves.toBeTruthy();
  });

  it('giao công việc phải qua nhiệm vụ: cán bộ nhận việc suy ra từ nhiệm vụ, nhiệm vụ không có thì không giao được', async () => {
    const input = { catalogItemCode: 'B.009', plannedQuantity: 1, dueDate: '2026-09-20', periodMode: 'AUTO' as const };
    await expect(h.service.assign(actorOf('head'), { ...input, taskId: 'khong-co' })).rejects.toBeInstanceOf(NotFoundException);

    const otherTask = await seedTask(h, 'head', PEOPLE.other, 'Nhiệm vụ của người khác');
    const view = await h.service.assign(actorOf('head'), { ...input, taskId: otherTask.id });
    expect(view.assignment.assigneePersonId).toBe(PEOPLE.other);
    expect(view.task.title).toBe('Nhiệm vụ của người khác');
  });

  it('một nhiệm vụ chứa nhiều công việc; danh sách việc gắn tên nhiệm vụ', async () => {
    const task = await seedTask(h);
    const a = await seedAssignment(h);
    const b = await h.service.assign(actorOf('head'), { taskId: task.id, catalogItemCode: 'A.003', plannedQuantity: 2, dueDate: '2026-09-25', periodMode: 'AUTO' });
    expect(a.assignment.taskId).toBe(task.id);
    expect(b.assignment.taskId).toBe(task.id);
    const rows = await h.service.list(actorOf('staff'), 'mine', false);
    expect(rows.map((r) => r.task.title)).toEqual(['Nhiệm vụ thử', 'Nhiệm vụ thử']);
  });

  it('danh sách nhiệm vụ theo phạm vi: của mình, của cấp dưới mọi cấp, toàn bộ cần quyền xem toàn bộ; nhiệm vụ rỗng vẫn hiện', async () => {
    await seedTask(h, 'head', PEOPLE.staff, 'Nhiệm vụ của nhân viên');
    await seedTask(h, 'deputy', PEOPLE.head, 'Nhiệm vụ của trưởng phòng');

    expect((await h.service.listTasks(actorOf('staff'), 'mine', false)).map((t) => t.title)).toEqual(['Nhiệm vụ của nhân viên']);
    expect((await h.service.listTasks(actorOf('head'), 'team', false)).map((t) => t.title)).toEqual(['Nhiệm vụ của nhân viên']);
    expect(await h.service.listTasks(actorOf('deputy'), 'team', false)).toHaveLength(2);
    expect(await h.service.listTasks(actorOf('other'), 'team', false)).toEqual([]);
    expect(await h.service.listTasks(actorOf(null), 'mine', false)).toEqual([]);
    await expect(h.service.listTasks(actorOf('head'), 'all', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await h.service.listTasks(actorOf('head'), 'all', true)).toHaveLength(2);
  });
});


describe('TaskingService: phạm vi áp dụng của công việc (ADR-021)', () => {
  let h: Harness;
  const UNIT = 'unit-1';
  const OTHER_UNIT = 'unit-2';
  const POSITION = 'pos-staff';

  beforeEach(async () => {
    h = await buildTasking();
    h.org.placements.set(PEOPLE.staff, { unitId: UNIT, positionId: POSITION });
  });

  const assign = async (code = 'B.009') => {
    const task = await seedTask(h);
    return h.service.assign(actorOf('head'), { taskId: task.id, catalogItemCode: code, plannedQuantity: 1, dueDate: '2026-09-20', periodMode: 'AUTO' });
  };
  const restrict = (scope: { unitIds?: string[]; positionIds?: string[] }) =>
    h.catalog.items.set('B.009', { ...h.catalog.items.get('B.009')!, ...scope });

  it('việc chung (chưa có phạm vi) giao được cho mọi người, kể cả người chưa có vị trí', async () => {
    h.org.placements.clear();
    await expect(assign()).resolves.toBeTruthy();
  });

  it('việc có phạm vi đơn vị: giao được cho người thuộc đơn vị, từ chối người ở đơn vị khác', async () => {
    restrict({ unitIds: [UNIT] });
    await expect(assign()).resolves.toBeTruthy();

    restrict({ unitIds: [OTHER_UNIT] });
    await expect(assign()).rejects.toBeInstanceOf(ConflictException);
  });

  it('việc có phạm vi vị trí: chỉ đúng vị trí được giao; đơn vị hoặc vị trí, đạt một là đủ', async () => {
    restrict({ positionIds: ['pos-khac'] });
    await expect(assign()).rejects.toBeInstanceOf(ConflictException);

    restrict({ unitIds: [OTHER_UNIT], positionIds: [POSITION] });
    await expect(assign()).resolves.toBeTruthy();
  });

  it('việc có phạm vi thì người chưa có vị trí nào không nhận được', async () => {
    restrict({ unitIds: [UNIT] });
    h.org.placements.clear();
    await expect(assign()).rejects.toBeInstanceOf(ConflictException);
  });
});
