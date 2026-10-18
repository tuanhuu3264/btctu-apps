import { earlyWarnings } from './early-warning.js';
import type { AssignmentView } from './tasking.service.js';

const view = (over: { id: string; due: string; created?: string; planned?: number; confirmed?: number; pending?: number; state?: AssignmentView['state']; person?: string; adHoc?: boolean }): AssignmentView =>
  ({
    assignment: {
      id: over.id,
      assigneePersonId: over.person ?? 'p1',
      plannedQuantity: over.planned ?? 10,
      dueDate: over.due,
      catalogItemCode: 'B.001',
      source: over.adHoc ? 'AD_HOC' : 'CATALOG',
      title: over.adHoc ? 'Việc đột xuất' : null,
      createdAt: new Date(`${over.created ?? '2026-10-01'}T00:00:00Z`),
    },
    task: { id: 't', title: 'Nhiệm vụ' },
    itemName: 'Tên việc',
    summary: { confirmedQuantity: over.confirmed ?? 0, pendingQuantity: over.pending ?? 0, reworkCount: 0, lateCount: 0, done: false },
    state: over.state ?? 'IN_PROGRESS',
  }) as unknown as AssignmentView;

const created = (v: AssignmentView) => v.assignment.createdAt.toISOString().slice(0, 10);
const run = (views: AssignmentView[], today = '2026-10-10') => earlyWarnings(views, today, created);

describe('cảnh báo sớm', () => {
  it('việc quá hạn là nguy cơ cao, kèm số ngày trễ', () => {
    const r = run([view({ id: 'a', due: '2026-10-07', state: 'OVERDUE', confirmed: 3 })]);
    expect(r.items[0]).toMatchObject({ kind: 'OVERDUE', level: 'HIGH', daysLeft: -3 });
    expect(r.items[0].text).toContain('quá hạn 3 ngày');
    expect(r.high).toBe(1);
  });

  it('sắp đến hạn: dưới 50% là cao, từ 50% là trung bình; còn nhiều ngày thì không cảnh báo', () => {
    const r = run([
      view({ id: 'low', due: '2026-10-12', confirmed: 2 }),
      view({ id: 'mid', due: '2026-10-12', confirmed: 6 }),
      view({ id: 'far', due: '2026-10-20', confirmed: 6 }),
    ]);
    expect(r.items.map((i) => [i.assignmentId, i.level, i.kind])).toEqual([
      ['low', 'HIGH', 'DUE_SOON'],
      ['mid', 'MEDIUM', 'DUE_SOON'],
    ]);
  });

  it('hết hạn hôm nay có chữ riêng', () => {
    const r = run([view({ id: 'a', due: '2026-10-10', confirmed: 1 })]);
    expect(r.items[0].text).toContain('Hết hạn hôm nay');
  });

  it('chậm so với tiến độ thời gian: việc dài đã qua nhiều thời gian mà làm ít', () => {
    const r = run([view({ id: 'a', created: '2026-09-01', due: '2026-10-30', confirmed: 1 })]); // đã qua 39/59 ngày (66%), mới làm 10%
    expect(r.items[0]).toMatchObject({ kind: 'BEHIND_PACE', level: 'MEDIUM' });
    // làm kịp tiến độ thì không cảnh báo
    expect(run([view({ id: 'b', created: '2026-09-01', due: '2026-10-30', confirmed: 6 })]).items).toEqual([]);
  });

  it('việc ngắn (dưới 7 ngày) không xét tiến độ theo thời gian', () => {
    expect(run([view({ id: 'a', created: '2026-10-08', due: '2026-10-14', confirmed: 0 })], '2026-10-10').items).toEqual([]);
  });

  it('số đang chờ xác nhận tính là đã làm; việc chờ xác nhận, hoàn thành, hủy, đề xuất bị bỏ qua', () => {
    const r = run([
      view({ id: 'pend', due: '2026-10-11', pending: 9 }), // 90% đã báo cáo
      view({ id: 'x1', due: '2026-10-07', state: 'PENDING_CONFIRM' }),
      view({ id: 'x2', due: '2026-10-07', state: 'DONE' }),
      view({ id: 'x3', due: '2026-10-07', state: 'CANCELLED' }),
      view({ id: 'x4', due: '2026-10-07', state: 'PROPOSED' }),
    ]);
    expect(r.items.map((i) => i.assignmentId)).toEqual(['pend']);
    expect(r.items[0].level).toBe('MEDIUM');
  });

  it('sắp xếp cao trước, rồi hạn gần trước; thống kê theo người', () => {
    const r = run([
      view({ id: 'm', due: '2026-10-12', confirmed: 6, person: 'p2' }),
      view({ id: 'h2', due: '2026-10-12', confirmed: 1, person: 'p1' }),
      view({ id: 'h1', due: '2026-10-08', state: 'OVERDUE', person: 'p1' }),
    ]);
    expect(r.items.map((i) => i.assignmentId)).toEqual(['h1', 'h2', 'm']);
    expect(r.byAssignee).toEqual([
      { personId: 'p1', high: 2, medium: 0 },
      { personId: 'p2', high: 0, medium: 1 },
    ]);
    expect([r.high, r.medium]).toEqual([2, 1]);
  });

  it('việc đột xuất lấy tên do người giao đặt', () => {
    expect(run([view({ id: 'a', due: '2026-10-11', adHoc: true })]).items[0].title).toBe('Việc đột xuất');
  });
});
