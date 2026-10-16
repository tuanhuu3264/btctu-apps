import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { actorOf, buildTasking, PEOPLE, seedTask } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('Việc lặp định kỳ (ADR-046)', () => {
  let h: Harness;
  let taskId: string;
  beforeEach(async () => {
    h = await buildTasking(); // hôm nay là 2026-10-03
    taskId = (await seedTask(h)).id;
  });

  const create = (input: Record<string, unknown> = {}) =>
    h.recurring.create(actorOf('head'), {
      taskId,
      catalogItemCode: 'B.009',
      plannedQuantity: 2,
      frequency: 'MONTHLY',
      startDate: '2026-07-01',
      dueAfterDays: 14,
      ...input,
    } as Parameters<Harness['recurring']['create']>[1]);

  const assignmentsOf = (templateId: string) => h.repos.assignments.rows.filter((a) => a.recurringTemplateId === templateId);

  describe('tạo mẫu', () => {
    it('cấp trên trực tiếp tạo mẫu cho cấp dưới; ghi nhật ký; có lần lặp kế tiếp', async () => {
      const t = await create({ note: 'Nộp báo cáo tháng' });
      expect(t).toMatchObject({
        assigneePersonId: PEOPLE.staff,
        source: 'CATALOG',
        catalogItemCode: 'B.009',
        frequency: 'MONTHLY',
        status: 'ACTIVE',
        periodMode: 'AUTO',
        reportKinds: ['MONTH', 'QUARTER', 'YEAR'],
        generatedCount: 0,
        nextOccurrence: '2026-11-01',
        note: 'Nộp báo cáo tháng',
      });
      expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.recurring.create', details: { frequency: 'MONTHLY', code: 'B.009' } });
    });

    it('chỉ cấp trên trực tiếp tạo được; kiểm danh mục, phạm vi và các tham số', async () => {
      const input = { taskId, catalogItemCode: 'B.009', plannedQuantity: 1, frequency: 'WEEKLY' as const, startDate: '2026-10-01', dueAfterDays: 5 };
      await expect(h.recurring.create(actorOf('deputy'), input)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.recurring.create(actorOf('staff'), input)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(create({ catalogItemCode: 'Z.999' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(create({ catalogItemCode: 'A.007' })).rejects.toBeInstanceOf(ConflictException); // chưa có điểm chấm
      await expect(create({ catalogItemCode: undefined })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ frequency: 'DAILY' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ plannedQuantity: 0 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ startDate: '01/07/2026' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ endDate: '2026-06-30' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ dueAfterDays: -1 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ dueAfterDays: 400 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(create({ periodMode: 'MANUAL' })).rejects.toBeInstanceOf(BadRequestException); // MANUAL cần chọn loại báo cáo
      await expect(create({ approverPersonId: PEOPLE.other })).rejects.toBeInstanceOf(BadRequestException); // người duyệt phải là cấp trên
    });

    it('mẫu việc đột xuất cần tên và mức độ khó; mã ảo lưu theo mức', async () => {
      const t = await create({ source: 'AD_HOC', catalogItemCode: undefined, title: 'Trực ban cuối tháng', difficulty: 2 });
      expect(t).toMatchObject({ source: 'AD_HOC', catalogItemCode: 'X.L2', title: 'Trực ban cuối tháng' });
      await expect(create({ source: 'AD_HOC', catalogItemCode: undefined, title: 'Trực ban' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('sinh việc', () => {
    it('sinh bù mọi lần lặp từ ngày bắt đầu đến hôm nay, hạn = ngày lặp + số ngày cấu hình, báo người nhận', async () => {
      const t = await create();
      const out = await h.recurring.run();
      expect(out).toEqual({ templates: 1, created: 4, errors: [] }); // 1/7, 1/8, 1/9, 1/10
      const rows = assignmentsOf(t.id);
      expect(rows.map((a) => [a.recurringKey, a.dueDate])).toEqual([
        ['2026-07-01', '2026-07-15'],
        ['2026-08-01', '2026-08-15'],
        ['2026-09-01', '2026-09-15'],
        ['2026-10-01', '2026-10-15'],
      ]);
      expect(rows[0]).toMatchObject({ assigneePersonId: PEOPLE.staff, catalogItemCode: 'B.009', plannedQuantity: 2, status: 'OPEN', source: 'CATALOG', assignerAccountId: 'acc-head', taskId });
      expect(h.notifier.of('TASK_ASSIGNED').filter((n) => n.title.includes('định kỳ'))).toHaveLength(4);
      expect(h.audit.filter((a) => a.action === 'tasking.assignment.create').at(-1)?.details).toMatchObject({ generated: true, occurrence: '2026-10-01', recurringTemplateId: t.id });
      expect((await h.repos.templates.findById(t.id))?.lastRunAt).not.toBeNull();
    });

    it('chạy lại không sinh trùng; sang kỳ mới thì sinh thêm đúng một việc', async () => {
      const t = await create();
      await h.recurring.run();
      expect(await h.recurring.run()).toMatchObject({ created: 0, errors: [] });
      expect(assignmentsOf(t.id)).toHaveLength(4);
      h.clock.current = new Date('2026-11-01T01:00:00Z'); // 08:00 giờ Việt Nam ngày 1/11
      expect(await h.recurring.run()).toMatchObject({ created: 1 });
      expect(assignmentsOf(t.id).map((a) => a.recurringKey).at(-1)).toBe('2026-11-01');
      expect((await h.recurring.list(actorOf('head'), false))[0]).toMatchObject({ generatedCount: 5, nextOccurrence: '2026-12-01' });
    });

    it('việc đã hủy vẫn giữ ngày lặp nên không sinh lại', async () => {
      const t = await create({ startDate: '2026-10-01' });
      await h.recurring.run();
      const [first] = assignmentsOf(t.id);
      await h.service.cancel(actorOf('head'), first.id);
      expect(await h.recurring.run()).toMatchObject({ created: 0 });
      expect(assignmentsOf(t.id)).toHaveLength(1);
    });

    it('hằng tuần sinh vào thứ Hai; ngày kết thúc chặn các lần sau; chưa đến ngày bắt đầu thì chưa sinh', async () => {
      const weekly = await create({ frequency: 'WEEKLY', startDate: '2026-09-14', endDate: '2026-09-28' });
      const later = await create({ startDate: '2026-12-01' });
      await h.recurring.run();
      expect(assignmentsOf(weekly.id).map((a) => a.recurringKey)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
      expect(assignmentsOf(later.id)).toEqual([]);
    });

    it('mẫu việc đột xuất sinh việc có tên và mã ảo; việc tính vào kỳ', async () => {
      const t = await create({ source: 'AD_HOC', catalogItemCode: undefined, title: 'Trực ban cuối tháng', difficulty: 3, startDate: '2026-10-01' });
      await h.recurring.run();
      expect(assignmentsOf(t.id)[0]).toMatchObject({ source: 'AD_HOC', catalogItemCode: 'X.L3', title: 'Trực ban cuối tháng' });
      expect(await h.service.collectForPeriod({ type: 'MONTH', startDate: '2026-10-01', endDate: '2026-10-31' })).toEqual([expect.objectContaining({ catalogItemCode: 'X.L3', plannedQuantity: 2 })]);
    });

    it('lỗi ở một mẫu được ghi lại và không chặn mẫu khác; hết lỗi thì tự sinh tiếp', async () => {
      const good = await create({ startDate: '2026-10-01' });
      const bad = await create({ catalogItemCode: 'A.003', startDate: '2026-10-01' });
      h.catalog.items.delete('A.003'); // công việc không còn trong danh mục
      const out = await h.recurring.run();
      expect(out.created).toBe(1);
      expect(out.errors).toEqual([expect.objectContaining({ templateId: bad.id, message: expect.stringContaining('A.003') })]);
      expect(assignmentsOf(good.id)).toHaveLength(1);
      expect((await h.repos.templates.findById(bad.id))?.lastError).toContain('A.003');

      h.catalog.items.set('A.003', { name: 'Thẩm định văn bản', coefficient: 1.3 });
      expect(await h.recurring.run()).toMatchObject({ created: 1, errors: [] });
      expect((await h.repos.templates.findById(bad.id))?.lastError).toBeNull();
    });

    it('người nhận đã ngừng quản lý thì không sinh và ghi lỗi', async () => {
      const t = await create({ startDate: '2026-10-01' });
      h.org.inactive.add(PEOPLE.staff);
      const out = await h.recurring.run();
      expect(out).toMatchObject({ created: 0, errors: [expect.objectContaining({ templateId: t.id })] });
    });

    it('hai tiến trình chạy cùng lúc: lượt sinh trùng bị chặn và bỏ qua, không gây lỗi', async () => {
      const t = await create({ startDate: '2026-10-01' });
      const [a, b] = await Promise.all([h.recurring.run(), h.recurring.run()]);
      expect(a.created + b.created).toBeGreaterThanOrEqual(1);
      expect(assignmentsOf(t.id)).toHaveLength(1);
      expect([...a.errors, ...b.errors]).toEqual([]);
    });
  });

  describe('quản lý mẫu', () => {
    it('sửa chỉ áp dụng cho lần lặp sau, việc đã sinh giữ nguyên; ghi trước/sau', async () => {
      const t = await create({ startDate: '2026-10-01' });
      await h.recurring.run();
      const updated = await h.recurring.update(actorOf('head'), t.id, { plannedQuantity: 9, dueAfterDays: 30, note: 'Mới' });
      expect(updated).toMatchObject({ plannedQuantity: 9, dueAfterDays: 30, note: 'Mới' });
      expect(assignmentsOf(t.id)[0]).toMatchObject({ plannedQuantity: 2, dueDate: '2026-10-15' }); // việc cũ không đổi
      expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.recurring.update', details: { before: { plannedQuantity: 2 }, after: { plannedQuantity: 9 } } });
      await expect(h.recurring.update(actorOf('head'), t.id, {})).rejects.toBeInstanceOf(BadRequestException);
      await expect(h.recurring.update(actorOf('head'), t.id, { title: 'Đổi tên' })).rejects.toBeInstanceOf(BadRequestException); // không phải việc đột xuất
      await expect(h.recurring.update(actorOf('deputy'), t.id, { plannedQuantity: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ngừng thì không sinh nữa; kích hoạt lại không sinh bù thời gian đã ngừng', async () => {
      const t = await create({ startDate: '2026-07-01' });
      await h.recurring.run(); // đã sinh 4 việc
      await h.recurring.deactivate(actorOf('head'), t.id);
      h.clock.current = new Date('2027-01-15T01:00:00Z');
      expect(await h.recurring.run()).toMatchObject({ templates: 0, created: 0 });
      await expect(h.recurring.deactivate(actorOf('head'), t.id)).rejects.toBeInstanceOf(ConflictException);

      const back = await h.recurring.reactivate(actorOf('head'), t.id);
      expect(back).toMatchObject({ status: 'ACTIVE', startDate: '2027-01-15', nextOccurrence: '2027-02-01' });
      expect(await h.recurring.run()).toMatchObject({ created: 0 }); // tháng 11, 12, 1 trong lúc ngừng không bị sinh bù
      expect(assignmentsOf(t.id)).toHaveLength(4);
      await expect(h.recurring.reactivate(actorOf('head'), t.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('danh sách: người tạo và cấp trên thấy; người nhận thấy mẫu của mình; người ngoài không thấy; xem toàn bộ thấy hết', async () => {
      await create();
      expect(await h.recurring.list(actorOf('head'), false)).toHaveLength(1);
      expect(await h.recurring.list(actorOf('staff'), false)).toHaveLength(1);
      expect(await h.recurring.list(actorOf('other'), false)).toHaveLength(0);
      expect(await h.recurring.list(actorOf('boss'), true)).toHaveLength(1);
    });

    it('"Sinh ngay" chỉ chạy mẫu mình quản lý', async () => {
      const mine = await create({ startDate: '2026-10-01' });
      expect(await h.recurring.runNow(actorOf('staff'), false)).toMatchObject({ created: 0 }); // người nhận không quản lý mẫu
      expect(assignmentsOf(mine.id)).toHaveLength(0);
      expect(await h.recurring.runNow(actorOf('head'), false)).toMatchObject({ created: 1 });
      expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.recurring.run', details: { manual: true, created: 1 } });
    });
  });
});
