import { actorOf, buildTasking, PEOPLE, seedAssignment } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const q = { scope: 'team' as const };

async function setup(): Promise<Harness> {
  const h = await buildTasking();
  h.org.names.set(PEOPLE.staff, { fullName: 'Nguyễn Văn Ắ' });
  h.org.names.set(PEOPLE.other, { fullName: 'Trần Thị B' });
  h.org.placements.set(PEOPLE.staff, { unitId: 'u1', positionId: 'pos-staff' });
  h.org.positionNames.set('pos-staff', { title: 'Chuyên viên', unitName: 'Phòng A' });
  return h;
}

describe('thống kê và xuất danh sách việc (A6)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await setup();
  });

  /** Ba việc của staff: một xong đúng hạn, một xong nhưng chậm, một quá hạn chưa làm. */
  async function seedThree() {
    const done = await seedAssignment(h, { dueDate: '2026-10-20' });
    const late = await seedAssignment(h, { dueDate: '2026-09-20' });
    await seedAssignment(h, { dueDate: '2026-09-15' }); // quá hạn (hôm nay là 2026-10-03)
    for (const [view, on] of [[done, '2026-10-02'], [late, '2026-10-01']] as const) {
      const p = await h.service.report(actorOf('staff'), view.assignment.id, { quantity: 10, completedOn: on });
      await h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' });
    }
  }

  it('thống kê: theo trạng thái, tỷ lệ việc chậm và chưa đạt, theo đơn vị', async () => {
    await seedThree();
    const s = await h.service.statistics(actorOf('head'), q, false);
    expect(s.byState).toMatchObject({ DONE: 2, OVERDUE: 1, IN_PROGRESS: 0, CANCELLED: 0 });
    expect(s.overall).toMatchObject({ total: 3, done: 2, overdue: 1, late: 2, lateRate: 0.6667, rework: 0, reworkRate: 0 });
    expect(s.byUnit).toEqual([expect.objectContaining({ unitName: 'Phòng A', total: 3, late: 2 })]);
  });

  it('việc đã hủy và đề xuất chưa duyệt không tính vào tỷ lệ', async () => {
    const a = await seedAssignment(h, { dueDate: '2026-10-20' });
    await seedAssignment(h, { dueDate: '2026-10-20' });
    await h.service.cancel(actorOf('head'), a.assignment.id);
    await h.service.propose(actorOf('staff'), { title: 'Việc gấp', plannedQuantity: 1, dueDate: '2026-10-20' });
    const s = await h.service.statistics(actorOf('head'), q, false);
    expect(s.byState).toMatchObject({ CANCELLED: 1, PROPOSED: 1, IN_PROGRESS: 1 });
    expect(s.overall.total).toBe(1);
    expect(s.overall.lateRate).toBe(0);
  });

  it('không có việc nào thì tỷ lệ rỗng, không chia cho 0', async () => {
    const s = await h.service.statistics(actorOf('head'), q, false);
    expect(s.overall).toMatchObject({ total: 0, lateRate: null, reworkRate: null });
    expect(s.byUnit).toEqual([]);
  });

  it('xuất Excel và PDF theo bộ lọc, ghi nhật ký; chỉ trong phạm vi người xuất', async () => {
    await seedThree();
    const xlsx = await h.service.exportAssignments(actorOf('head'), { ...q, states: ['OVERDUE'] }, false, 'xlsx');
    expect(xlsx.filename).toMatch(/^viec-duoc-giao-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(xlsx.buffer.length).toBeGreaterThan(1000);
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.export', details: { format: 'xlsx', scope: 'team', rows: 1, states: ['OVERDUE'] } });

    const pdf = await h.service.exportAssignments(actorOf('head'), q, false, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(h.audit.at(-1)).toMatchObject({ details: { format: 'pdf', rows: 3 } });

    // Cán bộ không thuộc nhánh này không xuất được việc của người khác.
    const mine = await h.service.exportAssignments(actorOf('other'), { scope: 'mine' }, false, 'xlsx');
    expect(h.audit.at(-1)).toMatchObject({ details: { rows: 0 } });
    expect(mine.buffer.length).toBeGreaterThan(500);
  });
});

describe('lọc theo loại việc (A6.3)', () => {
  it('phân biệt việc giao từ danh mục, đột xuất và định kỳ; loại sai bị từ chối', async () => {
    const h = await buildTasking();
    await seedAssignment(h, { dueDate: '2026-10-20' });
    await h.service.propose(actorOf('staff'), { title: 'Việc gấp', plannedQuantity: 1, dueDate: '2026-10-20' });
    const task = (await h.repos.tasks.findByAssigneeAndTitle(PEOPLE.staff, 'Nhiệm vụ thử'))!;
    await h.service.assign(actorOf('head'), { taskId: task.id, source: 'AD_HOC', title: 'Việc đột xuất giao', difficulty: 2, plannedQuantity: 1, dueDate: '2026-10-21', periodMode: 'AUTO' });
    const count = async (kind?: 'CATALOG' | 'AD_HOC' | 'RECURRING') => (await h.service.search(actorOf('head'), { scope: 'team', kind }, false)).total;
    expect(await count()).toBe(3); // gồm đề xuất chưa duyệt (trạng thái PROPOSED)
    expect(await count('CATALOG')).toBe(1);
    expect(await count('AD_HOC')).toBe(2); // một đề xuất và một việc giao đột xuất
    expect(await count('RECURRING')).toBe(0);
    await expect(h.service.search(actorOf('head'), { scope: 'team', kind: 'KHAC' as never }, false)).rejects.toThrow(/Loại việc/);
  });
});
