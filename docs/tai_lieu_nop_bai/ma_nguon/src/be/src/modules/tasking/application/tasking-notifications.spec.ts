import { actorOf, buildTasking, PEOPLE, seedAssignment } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('Thông báo của tasking (ADR-029)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  const sorted = (a: string[]) => [...a].sort();

  it('giao việc: người nhận được báo; người duyệt và người tham vấn được báo riêng; người giao không tự nhận', async () => {
    const { assignment } = await seedAssignment(h, { approverPersonId: PEOPLE.deputy, consultantPersonIds: [PEOPLE.other] });
    expect(h.notifier.of('TASK_ASSIGNED')).toEqual([expect.objectContaining({ to: [PEOPLE.staff], link: `/tasks?open=${assignment.id}` })]);
    const roles = h.notifier.of('TASK_ROLE');
    expect(roles.map((r) => r.to)).toEqual([[PEOPLE.deputy], [PEOPLE.other]]);
    expect(roles[0].title).toMatch(/duyệt/);
    expect(roles[1].title).toMatch(/tham vấn/);
    expect(h.notifier.sent.flatMap((s) => s.to)).not.toContain(PEOPLE.head);
  });

  it('không có người duyệt hay tham vấn thì chỉ một thông báo giao việc', async () => {
    await seedAssignment(h);
    expect(h.notifier.sent.map((s) => s.type)).toEqual(['TASK_ASSIGNED']);
  });

  it('báo cáo kết quả: báo người xác nhận (cấp trên trực tiếp hoặc người duyệt được chỉ định)', async () => {
    const direct = await seedAssignment(h);
    await h.service.report(actorOf('staff'), direct.assignment.id, { quantity: 1, completedOn: '2026-09-10' });
    expect(h.notifier.of('TASK_REPORTED').at(-1)?.to).toEqual([PEOPLE.head]);

    const designated = await seedAssignment(h, { catalogItemCode: 'A.003', approverPersonId: PEOPLE.deputy });
    await h.service.report(actorOf('staff'), designated.assignment.id, { quantity: 1, completedOn: '2026-09-10' });
    expect(h.notifier.of('TASK_REPORTED').at(-1)?.to).toEqual([PEOPLE.deputy]);
  });

  it('xác nhận hoặc từ chối: báo người nhận việc, tiêu đề không nêu số lượng hay lý do', async () => {
    const { assignment } = await seedAssignment(h);
    const p1 = await h.service.report(actorOf('staff'), assignment.id, { quantity: 1, completedOn: '2026-09-10' });
    await h.service.decide(actorOf('head'), p1.id, { decision: 'REJECT', note: 'Thiếu biên bản bí mật', majorError: false });
    const p2 = await h.service.report(actorOf('staff'), assignment.id, { quantity: 1, completedOn: '2026-09-11' });
    await h.service.decide(actorOf('head'), p2.id, { decision: 'CONFIRM' });

    expect(h.notifier.of('TASK_REJECTED')).toEqual([expect.objectContaining({ to: [PEOPLE.staff] })]);
    expect(h.notifier.of('TASK_CONFIRMED')).toEqual([expect.objectContaining({ to: [PEOPLE.staff] })]);
    expect(JSON.stringify(h.notifier.sent)).not.toContain('bí mật');
  });

  it('hủy việc: báo những người liên quan trừ người hủy', async () => {
    const { assignment } = await seedAssignment(h, { approverPersonId: PEOPLE.deputy, consultantPersonIds: [PEOPLE.other] });
    await h.service.cancel(actorOf('head'), assignment.id);
    const sent = h.notifier.of('TASK_CANCELLED');
    expect(sent).toHaveLength(1);
    expect(sorted(sent[0].to)).toEqual(sorted([PEOPLE.staff, PEOPLE.deputy, PEOPLE.other]));
  });

  it('bình luận: báo các thành viên khác, không báo người viết; thao tác lỗi thì không có thông báo', async () => {
    const { assignment } = await seedAssignment(h, { approverPersonId: PEOPLE.deputy, consultantPersonIds: [PEOPLE.other] });
    h.notifier.sent = [];
    await h.collab.addComment(actorOf('staff'), assignment.id, { body: 'Đã xong phần 1' });
    const sent = h.notifier.of('TASK_COMMENT');
    expect(sent).toHaveLength(1);
    expect(sorted(sent[0].to)).toEqual(sorted([PEOPLE.head, PEOPLE.deputy, PEOPLE.other]));
    expect(JSON.stringify(sent)).not.toContain('Đã xong phần 1');

    h.notifier.sent = [];
    await expect(h.collab.addComment(actorOf('staff'), assignment.id, { body: '   ' })).rejects.toThrow();
    expect(h.notifier.sent).toEqual([]);
  });
});
