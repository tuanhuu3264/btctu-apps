import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { safeFileName } from './collaboration.service.js';
import { actorOf, buildTasking, PEOPLE, seedAssignment } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const pdf = (extra = 'noi dung') => Buffer.from(`%PDF-1.4 ${extra}`);
const file = (name: string, buffer: Buffer = pdf()) => ({ originalName: name, size: buffer.length, buffer });

describe('TaskingService: người duyệt (cc) và người tham vấn (ADR-024)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  it('chọn người duyệt là cấp trên của người nhận và người tham vấn; người duyệt thành người xác nhận', async () => {
    const view = await seedAssignment(h, { approverPersonId: PEOPLE.deputy, consultantPersonIds: [PEOPLE.other, PEOPLE.boss], note: 'Soạn báo cáo quý III', dueDate: '2026-10-20' });
    expect(view).toMatchObject({
      approverPersonId: PEOPLE.deputy,
      confirmerPersonId: PEOPLE.deputy,
      consultantPersonIds: [PEOPLE.other, PEOPLE.boss],
      state: 'IN_PROGRESS',
    });
    expect(view.assignment).toMatchObject({ note: 'Soạn báo cáo quý III', createdAt: new Date('2026-10-03T08:00:00Z') });
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.assignment.create', details: expect.objectContaining({ approverPersonId: PEOPLE.deputy, consultants: 2 }) });
  });

  it('không chọn người duyệt thì vẫn là cấp trên trực tiếp (hành vi cũ)', async () => {
    const view = await seedAssignment(h);
    expect(view).toMatchObject({ approverPersonId: null, confirmerPersonId: PEOPLE.head, consultantPersonIds: [] });
  });

  it('chỉ người duyệt được chọn mới xác nhận hoặc từ chối; cấp trên trực tiếp không còn quyền xác nhận', async () => {
    const { assignment } = await seedAssignment(h, { approverPersonId: PEOPLE.deputy });
    const p = await h.service.report(actorOf('staff'), assignment.id, { quantity: 4, completedOn: '2026-09-10' });
    await expect(h.service.decide(actorOf('head'), p.id, { decision: 'CONFIRM' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.decide(actorOf('boss'), p.id, { decision: 'CONFIRM' })).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.decide(actorOf('deputy'), p.id, { decision: 'CONFIRM' });
    expect((await h.service.get(actorOf('staff'), assignment.id, false)).summary.confirmedQuantity).toBe(4);
  });

  it('từ chối người duyệt không phải cấp trên, người tham vấn là người nhận, không tồn tại, hoặc quá 10 người', async () => {
    await expect(seedAssignment(h, { approverPersonId: PEOPLE.other })).rejects.toBeInstanceOf(BadRequestException); // ngang cấp
    await expect(seedAssignment(h, { approverPersonId: PEOPLE.staff })).rejects.toBeInstanceOf(BadRequestException); // chính người nhận
    await expect(seedAssignment(h, { consultantPersonIds: [PEOPLE.staff] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedAssignment(h, { consultantPersonIds: ['p-ghost-1'] })).rejects.toBeInstanceOf(BadRequestException);
    h.org.inactive.add(PEOPLE.other);
    await expect(seedAssignment(h, { consultantPersonIds: [PEOPLE.other] })).rejects.toBeInstanceOf(BadRequestException); // đã ngừng
    await expect(seedAssignment(h, { consultantPersonIds: Array.from({ length: 11 }, (_, i) => `p-x${i}`) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedAssignment(h, { note: 'x'.repeat(4001) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bỏ trùng người tham vấn', async () => {
    const view = await seedAssignment(h, { consultantPersonIds: [PEOPLE.other, PEOPLE.other] });
    expect(view.consultantPersonIds).toEqual([PEOPLE.other]);
  });

  it('người giao sửa nội dung, người duyệt, người tham vấn; null đưa người duyệt về cấp trên trực tiếp', async () => {
    const { assignment } = await seedAssignment(h, { approverPersonId: PEOPLE.deputy });
    const changed = await h.service.update(actorOf('head'), assignment.id, { note: '  Nội dung mới  ', consultantPersonIds: [PEOPLE.other] });
    expect(changed.assignment.note).toBe('Nội dung mới');
    expect(changed).toMatchObject({ approverPersonId: PEOPLE.deputy, consultantPersonIds: [PEOPLE.other] });

    const reverted = await h.service.update(actorOf('head'), assignment.id, { approverPersonId: null });
    expect(reverted).toMatchObject({ approverPersonId: null, confirmerPersonId: PEOPLE.head, consultantPersonIds: [PEOPLE.other] }); // người tham vấn giữ nguyên
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.assignment.update' });
  });

  it('chỉ người giao sửa được, và chỉ khi việc còn mở', async () => {
    const { assignment } = await seedAssignment(h);
    await expect(h.service.update(actorOf('staff'), assignment.id, { note: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.update(actorOf('deputy'), assignment.id, { note: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.update(actorOf('head'), assignment.id, { approverPersonId: PEOPLE.other })).rejects.toBeInstanceOf(BadRequestException);
    await h.service.cancel(actorOf('head'), assignment.id);
    await expect(h.service.update(actorOf('head'), assignment.id, { note: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('người tham vấn và người duyệt xem được việc dù không thuộc cây cấp trên của người nhận', async () => {
    const { assignment } = await seedAssignment(h, { consultantPersonIds: [PEOPLE.other] });
    await expect(h.service.get(actorOf('other'), assignment.id, false)).resolves.toBeTruthy();
    const { assignment: second } = await seedAssignment(h);
    await expect(h.service.get(actorOf('other'), second.id, false)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TaskingService: theo dõi việc có lọc và phân trang (ADR-024 mục 7)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  const makeMany = async () => {
    const a = await seedAssignment(h, { dueDate: '2026-09-20', note: 'Báo cáo quý III cho Ban', consultantPersonIds: [PEOPLE.other] }); // quá hạn (hôm nay 03/10)
    const b = await seedAssignment(h, { catalogItemCode: 'A.003', dueDate: '2026-10-20', note: 'Thẩm định văn bản' }); // đang làm
    const c = await seedAssignment(h, { dueDate: '2026-10-25', approverPersonId: PEOPLE.deputy });
    const d = await seedAssignment(h, { dueDate: '2026-10-30' });
    await h.service.report(actorOf('staff'), b.assignment.id, { quantity: 3, completedOn: '2026-10-02' }); // chờ xác nhận
    await h.service.cancel(actorOf('head'), d.assignment.id); // đã hủy
    return { a, b, c, d };
  };

  it('suy ra trạng thái và đếm theo trạng thái', async () => {
    await makeMany();
    const r = await h.service.search(actorOf('staff'), { scope: 'mine' }, false);
    expect(r.total).toBe(4);
    expect(r.stateCounts).toEqual({ IN_PROGRESS: 1, PENDING_CONFIRM: 1, OVERDUE: 1, DONE: 0, CANCELLED: 1 });
  });

  it('lọc theo trạng thái (nhiều trạng thái), từ khóa không dấu, hạn, ngày giao', async () => {
    const { a, b } = await makeMany();
    const ids = async (q: object) => (await h.service.search(actorOf('staff'), { scope: 'mine', ...q }, false)).items.map((v) => v.assignment.id);
    expect(await ids({ states: ['OVERDUE'] })).toEqual([a.assignment.id]);
    expect((await ids({ states: ['OVERDUE', 'PENDING_CONFIRM'] })).sort()).toEqual([a.assignment.id, b.assignment.id].sort());
    expect(await ids({ q: 'tham dinh van ban' })).toEqual([b.assignment.id]); // khớp nội dung, không cần dấu
    expect(await ids({ q: 'A.003' })).toEqual([b.assignment.id]); // khớp mã công việc
    expect(await ids({ q: 'van ban tham dinh' })).toEqual([b.assignment.id]); // nhiều từ, thứ tự bất kỳ
    expect(await ids({ q: 'tham dinh bao cao' })).toEqual([]); // mọi từ phải có mặt
    expect(await ids({ dueFrom: '2026-10-01', dueTo: '2026-10-21' })).toEqual([b.assignment.id]);
    expect(await ids({ createdFrom: '2026-10-03', createdTo: '2026-10-03' })).toHaveLength(4);
    expect(await ids({ createdFrom: '2026-10-04' })).toEqual([]);
    expect(await ids({ assigneePersonId: PEOPLE.other })).toEqual([]);
  });

  it('phân trang và sắp xếp; tổng không đổi theo trang', async () => {
    await makeMany();
    const p1 = await h.service.search(actorOf('staff'), { scope: 'mine', pageSize: 3, page: 1 }, false);
    const p2 = await h.service.search(actorOf('staff'), { scope: 'mine', pageSize: 3, page: 2 }, false);
    expect([p1.items.length, p2.items.length, p1.total, p2.total]).toEqual([3, 1, 4, 4]);
    expect(p1.items.map((v) => v.assignment.dueDate)).toEqual(['2026-09-20', '2026-10-20', '2026-10-25']);
    const desc = await h.service.search(actorOf('staff'), { scope: 'mine', sort: 'dueDesc', pageSize: 1 }, false);
    expect(desc.items[0].assignment.dueDate).toBe('2026-10-30');
    expect((await h.service.search(actorOf('staff'), { scope: 'mine', page: 9 }, false)).items).toEqual([]);
  });

  it('phạm vi: được tham vấn, chờ tôi duyệt, tôi đã giao, cấp dưới', async () => {
    const { a, c } = await makeMany();
    const ids = async (who: Parameters<typeof actorOf>[0], scope: 'consulted' | 'approving' | 'assigned' | 'team') =>
      (await h.service.search(actorOf(who), { scope }, false)).items.map((v) => v.assignment.id).sort();
    expect(await ids('other', 'consulted')).toEqual([a.assignment.id]);
    expect(await ids('staff', 'consulted')).toEqual([]);
    expect(await ids('deputy', 'approving')).toEqual([c.assignment.id]); // chỉ định rõ; việc khác do head (cấp trên trực tiếp) duyệt
    const headApproving = await ids('head', 'approving');
    expect(headApproving).toHaveLength(3); // 4 việc trừ việc đã chọn deputy làm người duyệt
    expect(headApproving).not.toContain(c.assignment.id);
    expect(await ids('head', 'assigned')).toHaveLength(4);
    expect(await ids('deputy', 'team')).toHaveLength(4);
  });

  it('phạm vi tất cả cần quyền xem toàn bộ; tài khoản chưa gắn cán bộ không có việc của mình', async () => {
    await makeMany();
    await expect(h.service.search(actorOf('staff'), { scope: 'all' }, false)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.search(actorOf('staff'), { scope: 'all' }, true)).total).toBe(4);
    expect((await h.service.search(actorOf(null), { scope: 'mine' }, false)).total).toBe(0);
  });

  it('từ chối trang, cỡ trang, ngày, trạng thái sai', async () => {
    const bad = (q: object) => h.service.search(actorOf('staff'), { scope: 'mine', ...q } as never, false);
    await expect(bad({ page: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bad({ pageSize: 101 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bad({ dueFrom: '20/10/2026' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(bad({ states: ['XONG'] })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CollaborationService: trao đổi (ADR-024 mục 5)', () => {
  let h: Harness;
  let assignmentId: string;
  beforeEach(async () => {
    h = await buildTasking();
    assignmentId = (await seedAssignment(h, { approverPersonId: PEOPLE.deputy, consultantPersonIds: [PEOPLE.other] })).assignment.id;
  });

  it('mọi thành viên gửi và đọc được; tin nhắn ghi tác giả và nhật ký không ghi nội dung', async () => {
    for (const who of ['head', 'staff', 'deputy', 'other'] as const) {
      await h.collab.addComment(actorOf(who), assignmentId, { body: `  Tin của ${who}  ` });
    }
    const { comments } = await h.collab.conversation(actorOf('staff'), assignmentId, false);
    expect(comments.map((c) => c.body)).toEqual(['Tin của head', 'Tin của staff', 'Tin của deputy', 'Tin của other']);
    expect(comments[1]).toMatchObject({ authorAccountId: 'acc-staff', authorPersonId: PEOPLE.staff, kind: 'MESSAGE' });
    expect(JSON.stringify(h.audit.at(-1))).not.toContain('Tin của other');
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.comment.create' });
  });

  it('người ngoài việc không đọc, không viết được; người xem toàn bộ chỉ đọc', async () => {
    await expect(h.collab.addComment(actorOf('boss'), assignmentId, { body: 'xin chào' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.collab.conversation(actorOf('boss'), assignmentId, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.collab.conversation(actorOf('boss'), assignmentId, true)).resolves.toBeTruthy();
    await expect(h.collab.addComment(actorOf('boss'), assignmentId, { body: 'xin chào' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.collab.conversation(actorOf(null), assignmentId, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.collab.conversation(actorOf('staff'), 'khong-co', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ý kiến tham vấn chỉ do người tham vấn gửi', async () => {
    await expect(h.collab.addComment(actorOf('staff'), assignmentId, { body: 'Ý kiến', kind: 'OPINION' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.collab.addComment(actorOf('head'), assignmentId, { body: 'Ý kiến', kind: 'OPINION' })).rejects.toBeInstanceOf(ForbiddenException);
    const opinion = await h.collab.addComment(actorOf('other'), assignmentId, { body: 'Nên bổ sung số liệu quý II', kind: 'OPINION' });
    expect(opinion.kind).toBe('OPINION');
  });

  it('từ chối tin nhắn rỗng hoặc quá dài', async () => {
    await expect(h.collab.addComment(actorOf('staff'), assignmentId, { body: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.addComment(actorOf('staff'), assignmentId, { body: 'x'.repeat(4001) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.addComment(actorOf('staff'), assignmentId, { body: 'ok', kind: 'KHAC' as never })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bỏ người tham vấn khỏi việc thì người đó không còn xem được trao đổi', async () => {
    await h.collab.addComment(actorOf('other'), assignmentId, { body: 'Ý kiến' });
    await h.service.update(actorOf('head'), assignmentId, { consultantPersonIds: [] });
    await expect(h.collab.conversation(actorOf('other'), assignmentId, false)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('CollaborationService: tệp đính kèm (ADR-024 mục 6)', () => {
  let h: Harness;
  let assignmentId: string;
  beforeEach(async () => {
    h = await buildTasking();
    assignmentId = (await seedAssignment(h, { consultantPersonIds: [PEOPLE.other] })).assignment.id;
  });

  it('tải lên rồi tải về đúng nội dung; kiểu nội dung theo đuôi tệp; ghi nhật ký tải lên và tải xuống', async () => {
    const up = await h.collab.upload(actorOf('staff'), assignmentId, file('Báo cáo quý III.pdf', pdf('abc')));
    expect(up).toMatchObject({ fileName: 'Báo cáo quý III.pdf', contentType: 'application/pdf', uploadedByAccountId: 'acc-staff', commentId: null });
    expect(up.storageKey).toMatch(new RegExp(`^assignments/${assignmentId}/`));
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.attachment.upload', details: expect.objectContaining({ fileName: 'Báo cáo quý III.pdf' }) });

    const got = await h.collab.download(actorOf('other'), assignmentId, up.id, false); // người tham vấn tải được
    expect(got.data.toString()).toBe('%PDF-1.4 abc');
    expect(h.audit.at(-1)).toMatchObject({ action: 'tasking.attachment.download' });
    expect((await h.collab.conversation(actorOf('head'), assignmentId, false)).attachments).toHaveLength(1);
  });

  it('chỉ thành viên tải lên và tải về; người xem toàn bộ chỉ tải về', async () => {
    await expect(h.collab.upload(actorOf('boss'), assignmentId, file('a.pdf'))).rejects.toBeInstanceOf(ForbiddenException);
    const up = await h.collab.upload(actorOf('head'), assignmentId, file('a.pdf'));
    await expect(h.collab.download(actorOf('boss'), assignmentId, up.id, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.collab.download(actorOf('boss'), assignmentId, up.id, true)).resolves.toBeTruthy();
  });

  it('tệp của việc này không tải được qua việc khác', async () => {
    const up = await h.collab.upload(actorOf('head'), assignmentId, file('a.pdf'));
    const other = (await seedAssignment(h, { catalogItemCode: 'A.003' })).assignment.id;
    await expect(h.collab.download(actorOf('head'), other, up.id, false)).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.collab.download(actorOf('head'), assignmentId, 'khong-co', false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chỉ nhận định dạng văn phòng và ảnh; đổi đuôi tệp bị chặn nhờ dấu hiệu đầu tệp', async () => {
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('chay.exe', Buffer.from('MZ....')))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('trang.html', Buffer.from('<html>')))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('khong-duoi', Buffer.from('abc')))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('gia.pdf', Buffer.from('MZ chương trình')))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('ghi-chu.txt', Buffer.from('văn bản thuần')))).resolves.toBeTruthy();
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('Bang.XLSX', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2])))).resolves.toMatchObject({
      contentType: expect.stringContaining('spreadsheetml'),
    });
  });

  it('từ chối tệp rỗng, quá 20 MB, và quá 30 tệp mỗi việc', async () => {
    await expect(h.collab.upload(actorOf('staff'), assignmentId, { originalName: 'a.pdf', size: 0, buffer: Buffer.alloc(0) })).rejects.toBeInstanceOf(BadRequestException);
    const big = Buffer.alloc(20 * 1024 * 1024 + 1);
    pdf().copy(big);
    await expect(h.collab.upload(actorOf('staff'), assignmentId, { originalName: 'lon.pdf', size: big.length, buffer: big })).rejects.toBeInstanceOf(BadRequestException);
    for (let i = 0; i < 30; i++) await h.collab.upload(actorOf('staff'), assignmentId, file(`t${i}.pdf`));
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('thua.pdf'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('gắn tệp vào tin nhắn của chính mình, không gắn vào tin của người khác hay việc khác', async () => {
    const mine = await h.collab.addComment(actorOf('staff'), assignmentId, { body: 'Gửi kèm' });
    const theirs = await h.collab.addComment(actorOf('head'), assignmentId, { body: 'Đã nhận' });
    const up = await h.collab.upload(actorOf('staff'), assignmentId, file('kem.pdf'), mine.id);
    expect(up.commentId).toBe(mine.id);
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('x.pdf'), theirs.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('x.pdf'), 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
    const other = (await seedAssignment(h, { catalogItemCode: 'A.003' })).assignment.id;
    await expect(h.collab.upload(actorOf('head'), other, file('x.pdf'), theirs.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('kho tệp lỗi thì không lưu bản ghi tệp', async () => {
    h.storage.put = async () => {
      throw new Error('mất kết nối');
    };
    await expect(h.collab.upload(actorOf('staff'), assignmentId, file('a.pdf'))).rejects.toThrow('mất kết nối');
    expect(h.repos.attachments.rows).toHaveLength(0);
  });
});

describe('CollaborationService: tài liệu trong công việc (ADR-025 mục 1)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildTasking();
  });

  async function seed() {
    const { assignment } = await seedAssignment(h, { consultantPersonIds: [PEOPLE.other] });
    await h.collab.upload(actorOf('staff'), assignment.id, file('Báo cáo tháng 9.pdf'));
    h.clock.current = new Date('2026-10-04T08:00:00Z');
    await h.collab.upload(actorOf('head'), assignment.id, file('Bảng số liệu.pdf'));
    return assignment;
  }

  it('thành viên thấy tệp của việc mình tham gia, mới nhất trước, kèm tên việc và người tải', async () => {
    const a = await seed();
    const r = await h.collab.searchFiles(actorOf('staff'), {}, false);
    expect(r.total).toBe(2);
    expect(r.items.map((f) => f.fileName)).toEqual(['Bảng số liệu.pdf', 'Báo cáo tháng 9.pdf']);
    expect(r.items[0]).toMatchObject({ assignmentId: a.id, taskTitle: 'Nhiệm vụ thử', uploadedByPersonId: PEOPLE.head, catalogItemCode: 'B.009' });
    // người tham vấn, người giao, người duyệt mặc định (cấp trên trực tiếp) đều thấy
    for (const who of ['other', 'head'] as const) expect((await h.collab.searchFiles(actorOf(who), {}, false)).total).toBe(2);
  });

  it('người ngoài việc không thấy tệp nào; người xem toàn bộ thấy tất cả', async () => {
    await seed();
    expect((await h.collab.searchFiles(actorOf('boss'), {}, false)).total).toBe(0);
    expect((await h.collab.searchFiles(actorOf('boss'), {}, true)).total).toBe(2);
    expect((await h.collab.searchFiles(actorOf(null), {}, false)).total).toBe(0);
  });

  it('lọc theo từ khóa không dấu, người tải, khoảng ngày; phân trang', async () => {
    await seed();
    const staff = actorOf('staff');
    expect((await h.collab.searchFiles(staff, { q: 'bao cao thang' }, false)).items.map((f) => f.fileName)).toEqual(['Báo cáo tháng 9.pdf']);
    expect((await h.collab.searchFiles(staff, { q: 'nhiem vu thu' }, false)).total).toBe(2); // tìm theo tên việc
    expect((await h.collab.searchFiles(staff, { uploaderPersonId: PEOPLE.head }, false)).total).toBe(1);
    expect((await h.collab.searchFiles(staff, { from: '2026-10-04' }, false)).items.map((f) => f.fileName)).toEqual(['Bảng số liệu.pdf']);
    expect((await h.collab.searchFiles(staff, { to: '2026-10-03' }, false)).items.map((f) => f.fileName)).toEqual(['Báo cáo tháng 9.pdf']);
    const p2 = await h.collab.searchFiles(staff, { page: 2, pageSize: 1 }, false);
    expect(p2).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(p2.items).toHaveLength(1);
    await expect(h.collab.searchFiles(staff, { page: 0 }, false)).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.searchFiles(staff, { pageSize: 101 }, false)).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.collab.searchFiles(staff, { from: '04/10/2026' }, false)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('safeFileName', () => {
  it('bỏ đường dẫn và ký tự điều khiển, giữ tiếng Việt và đuôi', () => {
    expect(safeFileName('C:\\Users\\a\\Báo cáo.pdf')).toBe('Báo cáo.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('a"b<c>d|e:f*g?.pdf')).toBe('a_b_c_d_e_f_g_.pdf');
    expect(safeFileName('   ')).toBe('tep');
    expect(safeFileName('..')).toBe('tep');
    const long = safeFileName(`${'a'.repeat(300)}.docx`);
    expect(long.length).toBe(200);
    expect(long.endsWith('.docx')).toBe(true);
  });
});
