import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { actorOf, buildTasking, PEOPLE, seedAssignment, seedTask } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const PERIOD = { type: 'MONTH' as const, startDate: '2026-10-01', endDate: '2026-10-31' };

describe('Việc đột xuất (ADR-046)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  describe('giao việc đột xuất', () => {
    it('cấp trên giao việc không có trong danh mục, chọn mức độ khó; hệ số theo mức; ghi nhật ký và báo người nhận', async () => {
      const task = await seedTask(h);
      const view = await h.service.assign(actorOf('head'), {
        taskId: task.id,
        source: 'AD_HOC',
        title: '  Chuẩn bị   báo cáo nhanh cho Thường trực ',
        difficulty: 3,
        plannedQuantity: 2,
        dueDate: '2026-10-10',
        periodMode: 'AUTO',
      });
      expect(view.assignment).toMatchObject({ source: 'AD_HOC', catalogItemCode: 'X.L3', title: 'Chuẩn bị báo cáo nhanh cho Thường trực', status: 'OPEN', assignerAccountId: 'acc-head' });
      expect(view).toMatchObject({ itemName: 'Chuẩn bị báo cáo nhanh cho Thường trực', coefficient: 2, adHocLevel: 3 });
      expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.assignment.create', details: { source: 'AD_HOC', code: 'X.L3', title: 'Chuẩn bị báo cáo nhanh cho Thường trực' } });
      expect(h.notifier.of('TASK_ASSIGNED')[0].title).toMatch(/đột xuất/);
    });

    it('bốn mức độ khó có hệ số 0,5 / 1 / 2 / 3', async () => {
      const task = await seedTask(h);
      const coefficients: number[] = [];
      for (const difficulty of [1, 2, 3, 4]) {
        const v = await h.service.assign(actorOf('head'), { taskId: task.id, source: 'AD_HOC', title: `Việc mức ${difficulty}`, difficulty, plannedQuantity: 1, dueDate: '2026-10-10', periodMode: 'AUTO' });
        coefficients.push(v.coefficient!);
      }
      expect(coefficients).toEqual([0.5, 1, 2, 3]);
    });

    it('từ chối khi thiếu tên, mức độ khó sai, hoặc người giao không có thẩm quyền', async () => {
      const task = await seedTask(h);
      const base = { taskId: task.id, source: 'AD_HOC' as const, title: 'Việc gấp', difficulty: 2, plannedQuantity: 1, dueDate: '2026-10-10', periodMode: 'AUTO' as const };
      await expect(h.service.assign(actorOf('head'), { ...base, title: undefined })).rejects.toBeInstanceOf(BadRequestException);
      await expect(h.service.assign(actorOf('head'), { ...base, title: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
      for (const difficulty of [0, 5, 2.5, undefined]) {
        await expect(h.service.assign(actorOf('head'), { ...base, difficulty: difficulty as number })).rejects.toBeInstanceOf(BadRequestException);
      }
      await expect(h.service.assign(actorOf('deputy'), base)).rejects.toBeInstanceOf(ForbiddenException); // không phải cấp trên trực tiếp
    });

    it('mã ảo X.Lx không giao được như việc trong danh mục; việc danh mục vẫn phải nêu mã', async () => {
      const task = await seedTask(h);
      const base = { taskId: task.id, plannedQuantity: 1, dueDate: '2026-10-10', periodMode: 'AUTO' as const };
      await expect(h.service.assign(actorOf('head'), { ...base, catalogItemCode: 'X.L2' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(h.service.assign(actorOf('head'), base)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('việc đột xuất báo cáo, xác nhận, tính vào kỳ như việc thường; dòng nguồn mang mã ảo', async () => {
      const task = await seedTask(h);
      const { assignment } = await h.service.assign(actorOf('head'), { taskId: task.id, source: 'AD_HOC', title: 'Việc gấp', difficulty: 4, plannedQuantity: 3, dueDate: '2026-10-10', periodMode: 'AUTO' });
      const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 3, completedOn: '2026-10-03' });
      await h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' });
      const works = await h.service.collectForPeriod(PERIOD);
      expect(works).toEqual([expect.objectContaining({ catalogItemCode: 'X.L4', plannedQuantity: 3, confirmedQuantity: 3, lateCount: 0, reworkCount: 0 })]);
    });
  });

  describe('đề xuất của cán bộ', () => {
    const propose = (input: Partial<Parameters<Harness['service']['propose']>[1]> = {}) =>
      h.service.propose(actorOf('staff'), { title: 'Hỗ trợ đoàn kiểm tra', plannedQuantity: 1, dueDate: '2026-10-20', ...input });

    it('tạo ở trạng thái chờ duyệt, vào nhiệm vụ "Việc đột xuất" tự tạo, báo cấp trên; chưa tính vào kỳ, chưa báo cáo được', async () => {
      const view = await propose({ difficulty: 3 });
      expect(view.assignment).toMatchObject({ status: 'PROPOSED', source: 'AD_HOC', assigneePersonId: PEOPLE.staff, assignerAccountId: null, catalogItemCode: 'X.L3', title: 'Hỗ trợ đoàn kiểm tra' });
      expect(view.state).toBe('PROPOSED');
      expect(view.task.title).toBe('Việc đột xuất');
      expect(h.notifier.of('TASK_PROPOSED')).toEqual([expect.objectContaining({ to: [PEOPLE.head], link: `/tasks?open=${view.assignment.id}` })]);
      expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['tasking.task.create', 'tasking.proposal.create']));

      expect(await h.service.collectForPeriod(PERIOD)).toEqual([]); // chưa được duyệt nên chưa tính
      await expect(h.service.report(actorOf('staff'), view.assignment.id, { quantity: 1, completedOn: '2026-10-03' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('mức độ khó đề xuất mặc định 2; dùng lại nhiệm vụ "Việc đột xuất" cho lần sau', async () => {
      const a = await propose();
      const b = await propose({ title: 'Việc khác' });
      expect(a.assignment.catalogItemCode).toBe('X.L2');
      expect(b.assignment.taskId).toBe(a.assignment.taskId);
    });

    it('chỉ đề xuất vào nhiệm vụ của chính mình; tài khoản chưa gắn cán bộ, người chưa có cấp trên đều bị từ chối', async () => {
      const mine = await seedTask(h, 'head', PEOPLE.staff, 'Nhiệm vụ của tôi');
      const others = await seedTask(h, 'head', PEOPLE.other, 'Nhiệm vụ người khác');
      expect((await propose({ taskId: mine.id })).assignment.taskId).toBe(mine.id);
      await expect(propose({ taskId: others.id })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.propose(actorOf(null), { title: 'Việc gấp', plannedQuantity: 1, dueDate: '2026-10-20' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.propose(actorOf('boss'), { title: 'Việc gấp', plannedQuantity: 1, dueDate: '2026-10-20' })).rejects.toBeInstanceOf(ConflictException);
      await expect(propose({ title: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(propose({ difficulty: 7 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(propose({ plannedQuantity: 0 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cấp trên duyệt: chọn mức độ khó, chỉnh số lượng và hạn; việc thành OPEN, người duyệt là người giao; báo người đề xuất', async () => {
      const { assignment } = await propose({ difficulty: 1 });
      const approved = await h.service.approveProposal(actorOf('head'), assignment.id, { difficulty: 4, plannedQuantity: 5, dueDate: '2026-10-25' });
      expect(approved.assignment).toMatchObject({ status: 'OPEN', catalogItemCode: 'X.L4', plannedQuantity: 5, dueDate: '2026-10-25', assignerAccountId: 'acc-head' });
      expect(approved).toMatchObject({ state: 'IN_PROGRESS', coefficient: 3, adHocLevel: 4 });
      expect(h.notifier.of('TASK_PROPOSAL_DECIDED')[0]).toMatchObject({ to: [PEOPLE.staff] });
      expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.proposal.approve', details: { level: 4, before: { plannedQuantity: 1, catalogItemCode: 'X.L1' }, after: { plannedQuantity: 5, catalogItemCode: 'X.L4' } } });

      // Từ giờ báo cáo và tính vào kỳ được; không duyệt lần hai.
      const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 5, completedOn: '2026-10-03' });
      await h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' });
      expect((await h.service.collectForPeriod({ ...PERIOD, endDate: '2026-10-31' }))[0]).toMatchObject({ catalogItemCode: 'X.L4', confirmedQuantity: 5 });
      await expect(h.service.approveProposal(actorOf('head'), assignment.id, { difficulty: 2 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('chỉ cấp trên trực tiếp duyệt hoặc từ chối; mức độ khó bắt buộc', async () => {
      const { assignment } = await propose();
      await expect(h.service.approveProposal(actorOf('deputy'), assignment.id, { difficulty: 2 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.approveProposal(actorOf('staff'), assignment.id, { difficulty: 2 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.rejectProposal(actorOf('deputy'), assignment.id, 'Không cần')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.approveProposal(actorOf('head'), assignment.id, { difficulty: 9 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('từ chối cần lý do; việc chuyển sang đã hủy, báo người đề xuất, không tính vào kỳ', async () => {
      const { assignment } = await propose();
      await expect(h.service.rejectProposal(actorOf('head'), assignment.id, 'x')).rejects.toBeInstanceOf(BadRequestException);
      const rejected = await h.service.rejectProposal(actorOf('head'), assignment.id, 'Việc này đã nằm trong kế hoạch');
      expect(rejected.state).toBe('CANCELLED');
      expect(h.notifier.of('TASK_PROPOSAL_DECIDED')[0].title).toMatch(/từ chối/);
      expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.proposal.reject', details: { reason: 'Việc này đã nằm trong kế hoạch' } });
      expect(await h.service.collectForPeriod(PERIOD)).toEqual([]);
      await expect(h.service.rejectProposal(actorOf('head'), assignment.id, 'Lần hai')).rejects.toBeInstanceOf(ConflictException);
    });

    it('việc thường không phải đề xuất nên không duyệt được', async () => {
      const { assignment } = await seedAssignment(h);
      await expect(h.service.approveProposal(actorOf('head'), assignment.id, { difficulty: 2 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('lọc theo trạng thái PROPOSED trong tìm kiếm; số đếm theo trạng thái có mục chờ duyệt', async () => {
      await propose();
      await seedAssignment(h);
      const page = await h.service.search(actorOf('head'), { scope: 'team', states: ['PROPOSED'] }, false);
      expect(page.total).toBe(1);
      expect(page.stateCounts).toMatchObject({ PROPOSED: 1, IN_PROGRESS: 0, OVERDUE: 1 });
    });
  });
});
