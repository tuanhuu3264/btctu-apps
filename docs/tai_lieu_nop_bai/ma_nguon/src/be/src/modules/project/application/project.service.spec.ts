import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { actorOf, buildProject, CAPS, PEOPLE, seedActive, seedProject } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('ProjectService: lập và vòng đời', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildProject();
  });

  it('lập đề án: mã theo loại và năm, chủ trì là người lập và là thành viên LEAD, đơn vị suy từ chủ trì, ghi nhật ký', async () => {
    const p = await seedProject(h);
    expect(p).toMatchObject({ code: 'DA-2026-001', kind: 'DE_AN', status: 'DRAFT', ownerPersonId: PEOPLE.head, unitId: 'u-phong', createdByAccountId: 'acc-head' });
    expect((await seedProject(h, 'head', { kind: 'DU_AN', title: 'Dự án thử' })).code).toBe('DUA-2026-001');
    expect((await seedProject(h)).code).toBe('DA-2026-002');
    expect(h.repos.members.rows.filter((m) => m.projectId === p.id)).toEqual([{ projectId: p.id, personId: PEOPLE.head, role: 'LEAD' }]);
    expect(h.audit[0]).toMatchObject({ action: 'project.create', details: { code: 'DA-2026-001' } });
  });

  it('giao chủ trì: cho chính mình hoặc cấp dưới; không cho người ngoài quyền, không cho cán bộ đã ngừng', async () => {
    expect((await seedProject(h, 'head', { ownerPersonId: PEOPLE.staff })).ownerPersonId).toBe(PEOPLE.staff);
    await expect(seedProject(h, 'head', { ownerPersonId: PEOPLE.deputy })).rejects.toBeInstanceOf(ForbiddenException);
    h.org.inactive.add(PEOPLE.other);
    await expect(seedProject(h, 'head', { ownerPersonId: PEOPLE.other })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.create(actorOf(null), { kind: 'DE_AN', title: 'Không cán bộ', startDate: '2026-10-01', endDate: '2026-12-31' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('từ chối tên, ngày, loại không hợp lệ', async () => {
    for (const title of ['', 'ab', 'x'.repeat(201)]) await expect(seedProject(h, 'head', { title })).rejects.toBeInstanceOf(BadRequestException);
    for (const [startDate, endDate] of [['2026-10-01', '2026-09-30'], ['2026-13-01', '2026-12-31'], ['2026-10-01', '31/12/2026']]) {
      await expect(seedProject(h, 'head', { startDate, endDate })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(seedProject(h, 'head', { kind: 'KHAC' as never })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chỉ chủ trì hoặc người lập sửa được; đang soạn sửa tự do, đã duyệt chỉ sửa mục tiêu, nội dung, ngày kết thúc', async () => {
    const p = await seedProject(h);
    await expect(h.service.update(actorOf('staff'), p.id, { title: 'Đổi tên' })).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.update(actorOf('head'), p.id, { title: 'Đề án đổi tên', objective: 'Mục tiêu' })).title).toBe('Đề án đổi tên');
    const active = await seedActive(h);
    await expect(h.service.update(actorOf('head'), active.id, { title: 'Đổi tên' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.update(actorOf('head'), active.id, { startDate: '2026-10-02' })).rejects.toBeInstanceOf(ConflictException);
    expect((await h.service.update(actorOf('head'), active.id, { endDate: '2027-01-31', description: 'Nội dung mới' })).endDate).toBe('2027-01-31');
  });

  it('đổi chủ trì khi đang soạn: chủ trì mới thành LEAD, chủ trì cũ ở lại làm thành viên', async () => {
    const p = await seedProject(h);
    const updated = await h.service.update(actorOf('head'), p.id, { ownerPersonId: PEOPLE.staff });
    expect(updated.ownerPersonId).toBe(PEOPLE.staff);
    const rows = h.repos.members.rows.filter((m) => m.projectId === p.id);
    expect(rows.find((m) => m.personId === PEOPLE.staff)?.role).toBe('LEAD');
    expect(rows.find((m) => m.personId === PEOPLE.head)?.role).toBe('MEMBER');
  });

  it('trình duyệt cần ít nhất một mốc; sau đó thông báo cho người có quyền duyệt', async () => {
    const p = await seedProject(h);
    await expect(h.service.submit(actorOf('head'), p.id)).rejects.toBeInstanceOf(ConflictException);
    await h.service.addMilestone(actorOf('head'), p.id, { title: 'Dự thảo', dueDate: '2026-11-01' });
    await expect(h.service.submit(actorOf('staff'), p.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.submit(actorOf('head'), p.id)).status).toBe('SUBMITTED');
    expect(h.notifier.of('PROJECT_SUBMITTED')[0]).toMatchObject({ to: ['permission:project:approve'], except: PEOPLE.head });
    await expect(h.service.submit(actorOf('head'), p.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('duyệt: chỉ người có thẩm quyền, không tự duyệt đề án mình chủ trì; trả lại về soạn thảo kèm lý do rồi trình lại', async () => {
    const p = await seedProject(h);
    await h.service.addMilestone(actorOf('head'), p.id, { title: 'Dự thảo', dueDate: '2026-11-01' });
    await h.service.submit(actorOf('head'), p.id);
    await expect(h.service.approve(actorOf('head'), p.id, CAPS.head)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.sendBack(actorOf('boss'), p.id, 'x', CAPS.boss)).rejects.toBeInstanceOf(BadRequestException);
    const back = await h.service.sendBack(actorOf('boss'), p.id, 'Bổ sung căn cứ pháp lý', CAPS.boss);
    expect(back).toMatchObject({ status: 'DRAFT', returnReason: 'Bổ sung căn cứ pháp lý' });
    expect(h.notifier.of('PROJECT_DECIDED').at(-1)?.to).toEqual([PEOPLE.head]);
    await h.service.submit(actorOf('head'), p.id);
    const ok = await h.service.approve(actorOf('boss'), p.id, CAPS.boss);
    expect(ok).toMatchObject({ status: 'ACTIVE', approvedByAccountId: 'acc-boss', returnReason: null });
    await expect(h.service.approve(actorOf('boss'), p.id, CAPS.boss)).rejects.toBeInstanceOf(ConflictException);
  });

  it('Trưởng ban làm chủ trì thì không tự duyệt được', async () => {
    const p = await seedProject(h, 'boss');
    await h.service.addMilestone(actorOf('boss'), p.id, { title: 'Dự thảo', dueDate: '2026-11-01' });
    await h.service.submit(actorOf('boss'), p.id);
    await expect(h.service.approve(actorOf('boss'), p.id, CAPS.boss)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nghiệm thu chỉ khi mọi mốc xong, ngày không ở tương lai; sau nghiệm thu không sửa được', async () => {
    const p = await seedActive(h);
    await expect(h.service.complete(actorOf('boss'), p.id, {}, CAPS.boss)).rejects.toBeInstanceOf(ConflictException);
    const ms = await h.repos.milestones.findByProjects([p.id]);
    for (const m of ms) await h.service.completeMilestone(actorOf('head'), p.id, m.id, {});
    await expect(h.service.complete(actorOf('head'), p.id, {}, CAPS.head)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.complete(actorOf('boss'), p.id, { completedOn: '2027-01-01' }, CAPS.boss)).rejects.toBeInstanceOf(BadRequestException);
    const done = await h.service.complete(actorOf('boss'), p.id, { note: 'Đạt yêu cầu' }, CAPS.boss);
    expect(done).toMatchObject({ status: 'COMPLETED', completedOn: '2026-10-10', closeNote: 'Đạt yêu cầu' });
    await expect(h.service.update(actorOf('head'), p.id, { description: 'x' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.addMilestone(actorOf('head'), p.id, { title: 'Thêm', dueDate: '2026-11-01' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('hủy: người lập hủy khi đang soạn; đã trình hoặc đang thực hiện chỉ người có thẩm quyền; cần lý do', async () => {
    const draft = await seedProject(h);
    await expect(h.service.cancel(actorOf('staff'), draft.id, 'Không cần nữa', CAPS.staff)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.cancel(actorOf('head'), draft.id, '', CAPS.head)).rejects.toBeInstanceOf(BadRequestException);
    expect((await h.service.cancel(actorOf('head'), draft.id, 'Không cần nữa', CAPS.head)).status).toBe('CANCELLED');
    const active = await seedActive(h);
    await expect(h.service.cancel(actorOf('head'), active.id, 'Dừng', CAPS.head)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.cancel(actorOf('boss'), active.id, 'Đổi chủ trương', CAPS.boss)).status).toBe('CANCELLED');
    await expect(h.service.cancel(actorOf('boss'), active.id, 'Lần hai', CAPS.boss)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ProjectService: thành viên và mốc tiến độ', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildProject();
  });

  it('thêm, bớt thành viên; không trùng, không bớt chủ trì, không bớt người còn mốc chưa xong', async () => {
    const p = await seedProject(h);
    await h.service.addMember(actorOf('head'), p.id, PEOPLE.staff);
    await expect(h.service.addMember(actorOf('head'), p.id, PEOPLE.staff)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.addMember(actorOf('staff'), p.id, PEOPLE.other)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.addMember(actorOf('head'), p.id, 'p-khong-co')).rejects.toBeInstanceOf(BadRequestException);
    expect(h.notifier.of('PROJECT_MEMBER_ADDED')[0].to).toEqual([PEOPLE.staff]);
    await expect(h.service.removeMember(actorOf('head'), p.id, PEOPLE.head)).rejects.toBeInstanceOf(ConflictException);
    await h.service.addMilestone(actorOf('head'), p.id, { title: 'Mốc', dueDate: '2026-11-01', assigneePersonId: PEOPLE.staff });
    await expect(h.service.removeMember(actorOf('head'), p.id, PEOPLE.staff)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.removeMember(actorOf('head'), p.id, PEOPLE.other)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mốc: hạn nằm trong thời gian đề án, người phụ trách là thành viên, trọng số hợp lệ; giao mốc thì báo cho người phụ trách', async () => {
    const p = await seedProject(h);
    const add = (over: object) => h.service.addMilestone(actorOf('head'), p.id, { title: 'Mốc', dueDate: '2026-11-01', ...over });
    await expect(add({ dueDate: '2026-09-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(add({ dueDate: '2027-01-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(add({ weight: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(add({ weight: 101 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(add({ assigneePersonId: PEOPLE.staff })).rejects.toBeInstanceOf(BadRequestException); // chưa là thành viên
    await h.service.addMember(actorOf('head'), p.id, PEOPLE.staff);
    const m = await add({ assigneePersonId: PEOPLE.staff });
    expect(m).toMatchObject({ status: 'PENDING', weight: 1, assigneePersonId: PEOPLE.staff });
    expect(h.notifier.of('PROJECT_MILESTONE_ASSIGNED')[0].to).toEqual([PEOPLE.staff]);
  });

  it('báo mốc xong: chủ trì hoặc người phụ trách, khi đề án đang thực hiện; mở lại do chủ trì; không đổi, xóa mốc đã xong', async () => {
    const p = await seedActive(h);
    const [first, second] = await h.repos.milestones.findByProjects([p.id]);
    await expect(h.service.completeMilestone(actorOf('other'), p.id, first.id, {})).rejects.toBeInstanceOf(ForbiddenException);
    const done = await h.service.completeMilestone(actorOf('staff'), p.id, first.id, { note: 'Đã gửi' });
    expect(done).toMatchObject({ status: 'DONE', completedOn: '2026-10-10', note: 'Đã gửi' });
    expect(h.audit.at(-1)).toMatchObject({ action: 'project.milestone.done', details: { late: false } });
    await expect(h.service.completeMilestone(actorOf('staff'), p.id, first.id, {})).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.updateMilestone(actorOf('head'), p.id, first.id, { title: 'Đổi' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.deleteMilestone(actorOf('head'), p.id, first.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.completeMilestone(actorOf('staff'), p.id, second.id, {})).rejects.toBeInstanceOf(ForbiddenException); // không phải mốc của staff
    await expect(h.service.reopenMilestone(actorOf('staff'), p.id, first.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.reopenMilestone(actorOf('head'), p.id, first.id)).status).toBe('PENDING');
    await expect(h.service.completeMilestone(actorOf('staff'), p.id, first.id, { completedOn: '2026-10-11' })).rejects.toBeInstanceOf(BadRequestException); // tương lai
    await expect(h.service.completeMilestone(actorOf('staff'), p.id, first.id, { completedOn: '2026-09-30' })).rejects.toBeInstanceOf(BadRequestException); // trước ngày bắt đầu
  });

  it('đề án đang soạn chưa báo mốc xong được; mốc của đề án khác không thao tác chéo', async () => {
    const a = await seedProject(h);
    const b = await seedProject(h);
    const m = await h.service.addMilestone(actorOf('head'), a.id, { title: 'Mốc', dueDate: '2026-11-01' });
    await expect(h.service.completeMilestone(actorOf('head'), a.id, m.id, {})).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.updateMilestone(actorOf('head'), b.id, m.id, { title: 'Chéo' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.deleteMilestone(actorOf('head'), b.id, m.id)).rejects.toBeInstanceOf(NotFoundException);
    await h.service.deleteMilestone(actorOf('head'), a.id, m.id);
    expect(h.repos.milestones.rows).toHaveLength(0);
  });
});

describe('ProjectService: xem, tìm, thống kê, cảnh báo, xuất', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildProject();
  });

  it('phạm vi xem: người ngoài không thấy; thành viên, cấp trên của chủ trì và người có quyền xem tất cả thì thấy', async () => {
    const p = await seedActive(h); // head chủ trì, staff thành viên
    await expect(h.service.get(actorOf('outsider'), p.id, CAPS.outsider)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.get(actorOf('other'), p.id, CAPS.other)).rejects.toBeInstanceOf(ForbiddenException);
    for (const who of ['head', 'staff', 'deputy', 'boss'] as const) expect((await h.service.get(actorOf(who), p.id, CAPS[who])).project.id).toBe(p.id);
    expect(await h.service.list(actorOf('outsider'), 'mine', CAPS.outsider)).toEqual([]);
    expect((await h.service.list(actorOf('staff'), 'mine', CAPS.staff)).map((r) => r.project.id)).toEqual([p.id]);
    expect(await h.service.list(actorOf('other'), 'team', CAPS.other)).toEqual([]);
    await expect(h.service.list(actorOf('head'), 'all', CAPS.head)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await h.service.list(actorOf('boss'), 'all', CAPS.boss)).toHaveLength(1);
    await expect(h.service.list(actorOf('boss'), 'khac' as never, CAPS.boss)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('phạm vi team: cấp trên thấy đề án do cấp dưới chủ trì kể cả khi không là thành viên', async () => {
    await seedProject(h, 'head', { ownerPersonId: PEOPLE.staff });
    expect(await h.service.list(actorOf('deputy'), 'mine', CAPS.deputy)).toEqual([]);
    expect(await h.service.list(actorOf('deputy'), 'team', CAPS.deputy)).toHaveLength(1);
  });

  it('chi tiết: tiến độ theo trọng số, mốc quá hạn, quyền thao tác theo vai trò và trạng thái', async () => {
    const p = await seedActive(h);
    h.clock.current = new Date('2026-10-25T03:00:00Z'); // mốc 20/10 đã quá hạn
    const asHead = await h.service.get(actorOf('head'), p.id, CAPS.head);
    expect(asHead.progress).toMatchObject({ ratio: 0, total: 2, done: 0, overdue: 1, nextDue: '2026-10-20' });
    expect(asHead.milestones[0]).toMatchObject({ title: 'Dự thảo đề án', overdue: true, assigneeName: 'Cán bộ staff' });
    expect(asHead.can).toMatchObject({ edit: true, submit: false, approve: false, complete: false, cancel: false, manageMilestones: true });
    const asBoss = await h.service.get(actorOf('boss'), p.id, CAPS.boss);
    expect(asBoss.can).toMatchObject({ edit: false, complete: true, cancel: true });
    await h.service.completeMilestone(actorOf('staff'), p.id, asHead.milestones[0].id, {});
    expect((await h.service.get(actorOf('head'), p.id, CAPS.head)).progress.ratio).toBeCloseTo(0.6667, 3); // trọng số 2 trên 3
  });

  it('tìm theo từ khóa không dấu, lọc theo trạng thái và loại', async () => {
    await seedProject(h, 'head', { title: 'Đề án chuyển đổi số' });
    await seedProject(h, 'head', { kind: 'DU_AN', title: 'Dự án cơ sở dữ liệu cán bộ' });
    const ids = async (f: object) => (await h.service.list(actorOf('head'), 'mine', CAPS.head, f)).map((r) => r.project.title);
    expect(await ids({ q: 'chuyen doi so' })).toEqual(['Đề án chuyển đổi số']);
    expect(await ids({ kind: 'DU_AN' })).toEqual(['Dự án cơ sở dữ liệu cán bộ']);
    expect(await ids({ status: 'ACTIVE' })).toEqual([]);
    expect(await ids({ q: 'phong thu' })).toHaveLength(2); // khớp tên đơn vị
    await expect(h.service.list(actorOf('head'), 'mine', CAPS.head, { status: 'X' as never })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cảnh báo sớm theo phạm vi: mốc quá hạn là cao, sắp đến hạn là theo dõi; đề án chưa duyệt không cảnh báo', async () => {
    await seedProject(h); // đang soạn: không cảnh báo
    const p = await seedActive(h);
    h.clock.current = new Date('2026-10-25T03:00:00Z');
    const w = await h.service.earlyWarning(actorOf('head'), 'mine', CAPS.head);
    expect(w.items.map((i) => [i.projectId, i.kind, i.level])).toEqual([[p.id, 'MILESTONE_OVERDUE', 'HIGH']]);
    expect(w.high).toBe(1);
    h.clock.current = new Date('2026-12-10T03:00:00Z');
    const later = await h.service.earlyWarning(actorOf('boss'), 'all', CAPS.boss);
    expect(later.items.map((i) => i.kind).sort()).toEqual(['MILESTONE_DUE_SOON', 'MILESTONE_OVERDUE']);
  });

  it('thống kê theo trạng thái, loại, đơn vị', async () => {
    await seedProject(h);
    await seedActive(h, { kind: 'DU_AN', title: 'Dự án đang chạy' });
    const s = await h.service.statistics(actorOf('boss'), 'all', CAPS.boss);
    expect(s).toMatchObject({ total: 2, byStatus: { DRAFT: 1, ACTIVE: 1 }, byKind: { DE_AN: 1, DU_AN: 1 }, active: { count: 1, averageProgress: 0 } });
    expect(s.byUnit).toEqual([{ unitName: 'Phòng thử', total: 2, active: 1, completed: 0 }]);
  });

  it('xuất Excel và PDF: đúng phạm vi, có ghi nhật ký; người không có quyền xem tất cả bị từ chối', async () => {
    await seedActive(h);
    const x = await h.service.exportProjects(actorOf('boss'), 'all', CAPS.boss, {}, 'xlsx');
    expect(x.filename).toMatch(/^de-an-du-an-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(x.buffer.subarray(0, 2).toString()).toBe('PK');
    const pdf = await h.service.exportProjects(actorOf('head'), 'mine', CAPS.head, { status: 'ACTIVE' }, 'pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(h.service.exportProjects(actorOf('head'), 'all', CAPS.head, {}, 'xlsx')).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.audit.filter((a) => a.action === 'project.export')).toHaveLength(2);
  });
});

describe('ProjectService: tài liệu và việc được giao', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildProject();
  });

  const pdf = (name = 'de-an.pdf') => ({ originalName: name, size: 9, buffer: Buffer.from('%PDF-1.4 x') });

  it('tải tệp lên và tải về: chỉ chủ trì hoặc người lập tải lên; người xem được thì tải về; ghi nhật ký; tệp sai đuôi bị từ chối', async () => {
    const p = await seedActive(h);
    const att = await h.service.upload(actorOf('head'), p.id, pdf());
    expect(att).toMatchObject({ fileName: 'de-an.pdf', contentType: 'application/pdf' });
    expect((att as unknown as { storageKey?: string }).storageKey).toBeUndefined();
    await expect(h.service.upload(actorOf('staff'), p.id, pdf())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.upload(actorOf('head'), p.id, { originalName: 'x.exe', size: 3, buffer: Buffer.from('abc') })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.upload(actorOf('head'), p.id, { originalName: 'gia.pdf', size: 3, buffer: Buffer.from('abc') })).rejects.toBeInstanceOf(BadRequestException);
    const got = await h.service.download(actorOf('staff'), p.id, att.id, CAPS.staff);
    expect(got.data.toString()).toBe('%PDF-1.4 x');
    await expect(h.service.download(actorOf('outsider'), p.id, att.id, CAPS.outsider)).rejects.toBeInstanceOf(ForbiddenException);
    const other = await seedActive(h);
    await expect(h.service.download(actorOf('head'), other.id, att.id, CAPS.head)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['project.attachment.upload', 'project.attachment.download']));
  });

  it('đề án đã hủy không đính kèm thêm được', async () => {
    const p = await seedProject(h);
    await h.service.cancel(actorOf('head'), p.id, 'Không cần', CAPS.head);
    await expect(h.service.upload(actorOf('head'), p.id, pdf())).rejects.toBeInstanceOf(ConflictException);
  });

  it('gắn và gỡ việc: chỉ chủ trì hoặc người lập đề án, và phải là người giao việc; việc thuộc đề án khác bị từ chối', async () => {
    const p = await seedActive(h);
    const q = await seedActive(h);
    h.work.items.set('w1', { projectId: null, assigner: 'acc-head', assignee: PEOPLE.staff, title: 'B.009 Phân loại văn bản' });
    h.work.items.set('w2', { projectId: null, assigner: 'acc-deputy', assignee: PEOPLE.head, title: 'A.001 Việc khác' });
    expect((await h.service.linkCandidates(actorOf('head'), p.id, CAPS.head)).map((c) => c.assignmentId)).toEqual(['w1']);
    await expect(h.service.linkCandidates(actorOf('staff'), p.id, CAPS.staff)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.linkWork(actorOf('staff'), p.id, 'w1')).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.linkWork(actorOf('head'), p.id, 'w1');
    expect((await h.service.get(actorOf('head'), p.id, CAPS.head)).work.map((w) => [w.assignmentId, w.assigneeName])).toEqual([['w1', 'Cán bộ staff']]);
    expect((await h.service.list(actorOf('head'), 'mine', CAPS.head)).find((r) => r.project.id === p.id)?.workCount).toBe(1);
    await expect(h.service.linkWork(actorOf('head'), q.id, 'w1')).rejects.toThrow('đã thuộc đề án khác');
    await expect(h.service.linkWork(actorOf('head'), p.id, 'w2')).rejects.toThrow('không phải người giao');
    await expect(h.service.unlinkWork(actorOf('head'), q.id, 'w1')).rejects.toBeInstanceOf(NotFoundException);
    await h.service.unlinkWork(actorOf('head'), p.id, 'w1');
    expect(h.work.items.get('w1')?.projectId).toBeNull();
    expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['project.link', 'project.unlink']));
  });

  it('đề án đã nghiệm thu hoặc đã hủy không gắn thêm việc', async () => {
    const p = await seedProject(h);
    await h.service.cancel(actorOf('head'), p.id, 'Không cần', CAPS.head);
    h.work.items.set('w1', { projectId: null, assigner: 'acc-head', assignee: PEOPLE.staff, title: 'Việc' });
    await expect(h.service.linkWork(actorOf('head'), p.id, 'w1')).rejects.toBeInstanceOf(ConflictException);
  });
});
