import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { findConflicts, overlaps } from './meeting-rules.js';
import type { MeetingModel } from './meeting.model.js';
import { actorOf, buildMeeting, CAPS, PEOPLE, seedMeeting, vn } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

describe('meeting-rules', () => {
  const d = (h: string) => new Date(`2026-10-12T${h}:00Z`);
  it('trùng giờ khi chồng lên nhau; chạm đầu mút không trùng', () => {
    expect(overlaps({ startAt: d('09:00'), endAt: d('10:00') }, { startAt: d('09:30'), endAt: d('11:00') })).toBe(true);
    expect(overlaps({ startAt: d('09:00'), endAt: d('10:00') }, { startAt: d('10:00'), endAt: d('11:00') })).toBe(false);
    expect(overlaps({ startAt: d('09:00'), endAt: d('12:00') }, { startAt: d('10:00'), endAt: d('11:00') })).toBe(true);
  });

  it('chỉ tính cuộc họp còn hiệu lực và người chưa từ chối; bỏ cuộc họp đang sửa', () => {
    const m = (id: string, status: MeetingModel['status']): MeetingModel => ({ id, status, title: id, startAt: d('09:00'), endAt: d('10:00') }) as MeetingModel;
    const a = (meetingId: string, personId: string, response: 'PENDING' | 'DECLINED') => ({ meetingId, personId, role: 'REQUIRED' as const, response, respondedAt: null, note: null, attended: null });
    const slot = { startAt: d('09:30'), endAt: d('09:45') };
    const meetings = [m('ok', 'SCHEDULED'), m('huy', 'CANCELLED'), m('tuchoi', 'SCHEDULED'), m('chinhminh', 'SCHEDULED')];
    const attendees = [a('ok', 'p1', 'PENDING'), a('huy', 'p1', 'PENDING'), a('tuchoi', 'p1', 'DECLINED'), a('chinhminh', 'p1', 'PENDING'), a('ok', 'p2', 'PENDING')];
    expect(findConflicts(slot, ['p1'], meetings, attendees, 'chinhminh').map((c) => c.meetingId)).toEqual(['ok']);
    expect(findConflicts(slot, ['p1', 'p2'], meetings, attendees, 'chinhminh').map((c) => [c.personId, c.meetingId])).toEqual([['p1', 'ok'], ['p2', 'ok']]);
    expect(findConflicts(slot, ['p3'], meetings, attendees)).toEqual([]);
  });
});

describe('MeetingService: tạo, sửa, hủy', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildMeeting();
  });

  it('tạo lịch họp: chủ trì mặc định là người tạo và mặc nhiên tham dự; người được mời chờ trả lời; thông báo mời; ghi nhật ký', async () => {
    const { meeting, conflicts } = await seedMeeting(h);
    expect(conflicts).toEqual([]);
    expect(meeting).toMatchObject({ title: 'Họp giao ban tuần', organizerPersonId: PEOPLE.head, status: 'SCHEDULED', createdByAccountId: 'acc-head', location: 'Phòng họp 1' });
    expect(meeting.startAt.toISOString()).toBe('2026-10-12T02:00:00.000Z');
    const rows = h.repos.attendees.rows.filter((a) => a.meetingId === meeting.id);
    expect(rows.find((a) => a.personId === PEOPLE.head)).toMatchObject({ role: 'ORGANIZER', response: 'ACCEPTED' });
    expect(rows.find((a) => a.personId === PEOPLE.staff)).toMatchObject({ role: 'REQUIRED', response: 'PENDING' });
    expect(rows.find((a) => a.personId === PEOPLE.other)).toMatchObject({ role: 'OPTIONAL', response: 'PENDING' });
    const sent = h.notifier.of('MEETING_INVITED')[0];
    expect(sent.to.sort()).toEqual([PEOPLE.other, PEOPLE.staff]);
    expect(sent.title).toContain('09:00 ngày 12/10/2026');
    expect(h.audit[0]).toMatchObject({ action: 'meeting.create', details: { attendees: 3 } });
  });

  it('ai đã gắn cán bộ đều tạo được; tài khoản chưa gắn cán bộ thì không', async () => {
    expect((await seedMeeting(h, 'staff')).meeting.organizerPersonId).toBe(PEOPLE.staff);
    await expect(h.service.create(actorOf(null), { readAll: false }, { title: 'Họp', startAt: vn('2026-10-12', '09:00'), endAt: vn('2026-10-12', '10:00') })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('chủ trì khác người tạo cũng được; thành phần phải là cán bộ còn được quản lý; trùng và chủ trì lặp được gộp', async () => {
    const { meeting } = await seedMeeting(h, 'staff', { organizerPersonId: PEOPLE.boss, attendees: [{ personId: PEOPLE.head }, { personId: PEOPLE.head, role: 'OPTIONAL' }, { personId: PEOPLE.boss }] });
    expect(meeting.organizerPersonId).toBe(PEOPLE.boss);
    const rows = h.repos.attendees.rows.filter((a) => a.meetingId === meeting.id);
    expect(rows.map((a) => [a.personId, a.role]).sort()).toEqual([[PEOPLE.boss, 'ORGANIZER'], [PEOPLE.head, 'OPTIONAL']]);
    await expect(seedMeeting(h, 'head', { attendees: [{ personId: PEOPLE.gone }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedMeeting(h, 'head', { attendees: [{ personId: PEOPLE.staff, role: 'KHAC' as never }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('từ chối tiêu đề, thời gian, đường dẫn không hợp lệ', async () => {
    for (const title of ['', 'ab', 'x'.repeat(201)]) await expect(seedMeeting(h, 'head', { title })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedMeeting(h, 'head', { endAt: vn('2026-10-12', '08:00') })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedMeeting(h, 'head', { endAt: vn('2026-10-12', '09:00') })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedMeeting(h, 'head', { startAt: vn('2026-10-12', '08:00'), endAt: vn('2026-10-12', '21:00') })).rejects.toBeInstanceOf(BadRequestException); // quá 12 giờ
    await expect(seedMeeting(h, 'head', { startAt: 'ngày mai' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedMeeting(h, 'head', { startAt: '2026-10-12' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(seedMeeting(h, 'head', { onlineLink: 'javascript:alert(1)' })).rejects.toBeInstanceOf(BadRequestException);
    expect((await seedMeeting(h, 'head', { onlineLink: 'https://meet.example.vn/abc' })).meeting.onlineLink).toBe('https://meet.example.vn/abc');
  });

  it('cảnh báo trùng lịch khi tạo: nêu người bận; không chặn; tên cuộc họp khác chỉ hiện nếu xem được', async () => {
    await seedMeeting(h, 'head', { title: 'Họp kín của phòng', attendees: [{ personId: PEOPLE.staff }] });
    const second = await seedMeeting(h, 'outsider', { title: 'Họp khác', startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00'), attendees: [{ personId: PEOPLE.staff }] });
    expect(second.meeting.id).toBeTruthy(); // vẫn tạo được
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]).toMatchObject({ personId: PEOPLE.staff, personName: 'Cán bộ staff', title: null, meetingId: null }); // người tạo không thuộc cuộc họp kia
    const asBoss = await h.service.checkConflicts(actorOf('boss'), CAPS.boss, { startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00'), attendeePersonIds: [PEOPLE.staff] });
    expect(asBoss.every((c) => c.title !== null)).toBe(true); // người có quyền xem tất cả thấy tên
    const asHead = await h.service.checkConflicts(actorOf('head'), CAPS.head, { startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00'), attendeePersonIds: [PEOPLE.staff] });
    expect(asHead).toHaveLength(2); // họp của head 09:00–10:30 và họp của boss 10:00–11:00
    expect(asHead.find((c) => c.title === 'Họp kín của phòng')).toBeTruthy();
    expect(asHead.find((c) => c.title === null)).toBeTruthy(); // họp của outsider: head không được mời
    const touching = await h.service.checkConflicts(actorOf('head'), CAPS.head, { startAt: vn('2026-10-12', '10:30'), endAt: vn('2026-10-12', '11:30'), attendeePersonIds: [PEOPLE.other] });
    expect(touching).toEqual([]); // chạm đầu mút không trùng
    await expect(h.service.checkConflicts(actorOf(null), { readAll: false }, { startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00'), attendeePersonIds: [] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('người đã từ chối cuộc họp kia không tính là trùng', async () => {
    const a = await seedMeeting(h, 'head', { attendees: [{ personId: PEOPLE.staff }] });
    await h.service.respond(actorOf('staff'), a.meeting.id, { response: 'DECLINED', note: 'Bận việc khác' });
    const second = await seedMeeting(h, 'boss', { title: 'Họp khác', attendees: [{ personId: PEOPLE.staff }] });
    expect(second.conflicts).toEqual([]);
  });

  it('sửa: chỉ chủ trì hoặc người tạo; đổi giờ thì đặt lại trả lời và báo người được mời; thêm bớt người dự có thông báo riêng', async () => {
    const { meeting } = await seedMeeting(h);
    await h.service.respond(actorOf('staff'), meeting.id, { response: 'ACCEPTED' });
    await expect(h.service.update(actorOf('staff'), CAPS.staff, meeting.id, { title: 'Đổi tên' })).rejects.toBeInstanceOf(ForbiddenException);
    h.notifier.sent.length = 0;
    const out = await h.service.update(actorOf('head'), CAPS.head, meeting.id, { startAt: vn('2026-10-13', '14:00'), endAt: vn('2026-10-13', '15:00'), attendees: [{ personId: PEOPLE.staff }, { personId: PEOPLE.boss }] });
    expect(out.meeting.startAt.toISOString()).toBe('2026-10-13T07:00:00.000Z');
    const rows = h.repos.attendees.rows.filter((a) => a.meetingId === meeting.id);
    expect(rows.find((a) => a.personId === PEOPLE.staff)?.response).toBe('PENDING'); // đã xác nhận giờ cũ: hỏi lại
    expect(rows.find((a) => a.personId === PEOPLE.head)?.response).toBe('ACCEPTED');
    expect(rows.find((a) => a.personId === PEOPLE.other)).toBeUndefined(); // bị bớt
    expect(h.notifier.of('MEETING_CHANGED').map((n) => n.to).flat().sort()).toEqual([PEOPLE.other, PEOPLE.staff].sort());
    expect(h.notifier.of('MEETING_INVITED')[0].to).toEqual([PEOPLE.boss]);
  });

  it('sửa không đổi giờ giữ nguyên trả lời; đổi chủ trì thì chủ trì cũ thành người dự', async () => {
    const { meeting } = await seedMeeting(h);
    await h.service.respond(actorOf('staff'), meeting.id, { response: 'ACCEPTED' });
    await h.service.update(actorOf('head'), CAPS.head, meeting.id, { location: 'Phòng họp 2' });
    expect(h.repos.attendees.rows.find((a) => a.meetingId === meeting.id && a.personId === PEOPLE.staff)?.response).toBe('ACCEPTED');
    await h.service.update(actorOf('head'), CAPS.head, meeting.id, { organizerPersonId: PEOPLE.staff });
    const rows = h.repos.attendees.rows.filter((a) => a.meetingId === meeting.id);
    expect(rows.find((a) => a.personId === PEOPLE.staff)).toMatchObject({ role: 'ORGANIZER', response: 'ACCEPTED' });
    expect(rows.find((a) => a.personId === PEOPLE.head)).toMatchObject({ role: 'REQUIRED' });
  });

  it('hủy họp cần lý do, báo người được mời; không sửa, không hủy lại', async () => {
    const { meeting } = await seedMeeting(h);
    await expect(h.service.cancel(actorOf('staff'), meeting.id, 'Hoãn')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.cancel(actorOf('head'), meeting.id, '')).rejects.toBeInstanceOf(BadRequestException);
    h.notifier.sent.length = 0;
    expect((await h.service.cancel(actorOf('head'), meeting.id, 'Hoãn theo yêu cầu lãnh đạo')).status).toBe('CANCELLED');
    expect(h.notifier.of('MEETING_CANCELLED')[0].to.sort()).toEqual([PEOPLE.other, PEOPLE.staff].sort());
    await expect(h.service.cancel(actorOf('head'), meeting.id, 'Lần hai')).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.update(actorOf('head'), CAPS.head, meeting.id, { title: 'Sửa' })).rejects.toBeInstanceOf(ConflictException);
    // họp đã hủy không còn gây trùng lịch
    expect((await seedMeeting(h, 'boss', { attendees: [{ personId: PEOPLE.staff }] })).conflicts).toEqual([]);
  });

  it('gắn đề án: chỉ đề án người tạo xem được; đổi hoặc gỡ được', async () => {
    await expect(seedMeeting(h, 'other', { projectId: 'pr-1' })).rejects.toThrow('không xem được đề án');
    const { meeting } = await seedMeeting(h, 'head', { projectId: 'pr-1' });
    expect(meeting.projectId).toBe('pr-1');
    expect((await h.service.get(actorOf('head'), meeting.id, CAPS.head)).project).toEqual({ code: 'DA-2026-001', title: 'Đề án thử' });
    expect((await h.service.update(actorOf('head'), CAPS.head, meeting.id, { projectId: null })).meeting.projectId).toBeNull();
  });
});

describe('MeetingService: trả lời, xem, danh sách', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildMeeting();
  });

  it('người được mời trả lời; từ chối cần lý do; chủ trì không trả lời; người ngoài không trả lời; báo cho chủ trì', async () => {
    const { meeting } = await seedMeeting(h);
    h.notifier.sent.length = 0;
    await expect(h.service.respond(actorOf('staff'), meeting.id, { response: 'DECLINED' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.respond(actorOf('staff'), meeting.id, { response: 'KHAC' as never })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.respond(actorOf('head'), meeting.id, { response: 'ACCEPTED' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.respond(actorOf('outsider'), meeting.id, { response: 'ACCEPTED' })).rejects.toBeInstanceOf(ForbiddenException);
    const declined = await h.service.respond(actorOf('staff'), meeting.id, { response: 'DECLINED', note: 'Đi công tác' });
    expect(declined).toMatchObject({ response: 'DECLINED', note: 'Đi công tác' });
    expect(h.notifier.of('MEETING_RESPONDED')[0]).toMatchObject({ to: [PEOPLE.head] });
    expect((await h.service.respond(actorOf('staff'), meeting.id, { response: 'ACCEPTED' })).response).toBe('ACCEPTED'); // đổi ý
  });

  it('phạm vi xem: người tạo, chủ trì, người được mời, người có quyền xem tất cả; người khác không', async () => {
    const { meeting } = await seedMeeting(h);
    for (const who of ['head', 'staff', 'other', 'boss'] as const) expect((await h.service.get(actorOf(who), meeting.id, CAPS[who])).meeting.id).toBe(meeting.id);
    await expect(h.service.get(actorOf('outsider'), meeting.id, CAPS.outsider)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.get(actorOf('head'), 'khong-co', CAPS.head)).rejects.toBeInstanceOf(NotFoundException);
    expect((await h.service.list(actorOf('staff'), CAPS.staff)).map((r) => r.meeting.id)).toEqual([meeting.id]);
    expect(await h.service.list(actorOf('outsider'), CAPS.outsider)).toEqual([]);
    await expect(h.service.list(actorOf('head'), CAPS.head, { scope: 'all' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(await h.service.list(actorOf('boss'), CAPS.boss, { scope: 'all' })).toHaveLength(1);
  });

  it('danh sách lọc theo khoảng thời gian, trạng thái, đề án; sắp theo giờ; kèm trả lời của tôi và đếm', async () => {
    const a = await seedMeeting(h, 'head', { title: 'Họp A', projectId: 'pr-1' });
    await seedMeeting(h, 'head', { title: 'Họp B', startAt: vn('2026-10-20', '09:00'), endAt: vn('2026-10-20', '10:00') });
    const c = await seedMeeting(h, 'head', { title: 'Họp C', startAt: vn('2026-10-15', '09:00'), endAt: vn('2026-10-15', '10:00') });
    await h.service.cancel(actorOf('head'), c.meeting.id, 'Không cần nữa');
    await h.service.respond(actorOf('staff'), a.meeting.id, { response: 'ACCEPTED' });
    const all = await h.service.list(actorOf('staff'), CAPS.staff);
    expect(all.map((r) => r.meeting.title)).toEqual(['Họp A', 'Họp C', 'Họp B']);
    expect(all[0]).toMatchObject({ myResponse: 'ACCEPTED', myRole: 'REQUIRED', attendeeCount: 3, accepted: 2, declined: 0, organizerName: 'Cán bộ head', project: { code: 'DA-2026-001', title: 'Đề án thử' } });
    expect((await h.service.list(actorOf('staff'), CAPS.staff, { from: vn('2026-10-14', '00:00'), to: vn('2026-10-18', '00:00') })).map((r) => r.meeting.title)).toEqual(['Họp C']);
    expect((await h.service.list(actorOf('staff'), CAPS.staff, { status: 'SCHEDULED' })).map((r) => r.meeting.title)).toEqual(['Họp A', 'Họp B']);
    expect((await h.service.list(actorOf('staff'), CAPS.staff, { projectId: 'pr-1' })).map((r) => r.meeting.title)).toEqual(['Họp A']);
    await expect(h.service.list(actorOf('staff'), CAPS.staff, { from: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.list(actorOf('staff'), CAPS.staff, { from: vn('2026-10-18', '00:00'), to: vn('2026-10-14', '00:00') })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.list(actorOf('staff'), CAPS.staff, { status: 'X' as never })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('chi tiết: quyền thao tác theo vai trò và thời điểm; kết thúc họp chỉ sau giờ bắt đầu', async () => {
    const { meeting } = await seedMeeting(h);
    const asHead = await h.service.get(actorOf('head'), meeting.id, CAPS.head);
    expect(asHead.can).toEqual({ edit: true, cancel: true, respond: false, conclude: false, manageActions: false, upload: true });
    expect(asHead.attendees.map((a) => a.role)).toEqual(['ORGANIZER', 'REQUIRED', 'OPTIONAL']);
    const asStaff = await h.service.get(actorOf('staff'), meeting.id, CAPS.staff);
    expect(asStaff.can).toMatchObject({ edit: false, respond: true, conclude: false, upload: false });
    expect(asStaff.myResponse).toBe('PENDING');
    h.clock.current = new Date('2026-10-12T03:00:00Z'); // 10:00 ngày họp
    expect((await h.service.get(actorOf('head'), meeting.id, CAPS.head)).can.conclude).toBe(true);
  });
});

describe('MeetingService: kết luận và việc sau họp', () => {
  let h: Harness;
  let id: string;
  beforeEach(async () => {
    h = await buildMeeting();
    id = (await seedMeeting(h)).meeting.id;
    await h.service.respond(actorOf('staff'), id, { response: 'ACCEPTED' });
  });

  const started = (h2: Harness) => {
    h2.clock.current = new Date('2026-10-12T04:00:00Z'); // 11:00 ngày 12/10, sau giờ bắt đầu
  };

  it('chưa đến giờ họp thì chưa kết thúc được; cần kết luận; chỉ chủ trì hoặc người tạo', async () => {
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: 'Thống nhất' })).rejects.toBeInstanceOf(ConflictException);
    started(h);
    await expect(h.service.conclude(actorOf('staff'), id, { conclusion: 'Thống nhất' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: ' ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('kết thúc họp: ghi kết luận, người có mặt (mặc định người đã xác nhận), tạo việc sau họp và báo người thực hiện', async () => {
    started(h);
    h.notifier.sent.length = 0;
    const done = await h.service.conclude(actorOf('head'), id, {
      conclusion: 'Thống nhất triển khai trong tháng 10',
      actions: [
        { content: 'Gửi dự thảo kế hoạch cho Văn phòng', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-15' },
        { content: 'Báo cáo Trưởng ban', assigneePersonId: PEOPLE.head, dueDate: '2026-10-20' },
      ],
    });
    expect(done).toMatchObject({ status: 'HELD', conclusion: 'Thống nhất triển khai trong tháng 10' });
    expect(done.concludedAt).toBeInstanceOf(Date);
    const rows = h.repos.attendees.rows.filter((a) => a.meetingId === id);
    expect(rows.find((a) => a.personId === PEOPLE.staff)?.attended).toBe(true);
    expect(rows.find((a) => a.personId === PEOPLE.other)?.attended).toBe(false); // chưa trả lời: coi là vắng
    expect(h.repos.actions.rows).toHaveLength(2);
    expect(h.notifier.of('MEETING_ACTION_ASSIGNED').map((n) => n.to).flat()).toEqual([PEOPLE.staff]); // không tự báo cho mình
    expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['meeting.conclude', 'meeting.action.add']));
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: 'Lần hai' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.cancel(actorOf('head'), id, 'Hủy sau họp')).rejects.toBeInstanceOf(ConflictException);
  });

  it('người có mặt và người thực hiện phải thuộc thành phần; hạn hợp lệ', async () => {
    started(h);
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: 'Xong', attendedPersonIds: [PEOPLE.outsider] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: 'Xong', actions: [{ content: 'Làm gì đó', assigneePersonId: PEOPLE.outsider, dueDate: '2026-10-20' }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: 'Xong', actions: [{ content: 'Làm gì đó', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-11' }] })).rejects.toBeInstanceOf(BadRequestException); // trước ngày họp
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: 'Xong', actions: [{ content: 'Làm gì đó', assigneePersonId: PEOPLE.staff, dueDate: '20/10/2026' }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.conclude(actorOf('head'), id, { conclusion: 'Xong', actions: [{ content: 'ab', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-20' }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(h.repos.meetings.rows[0].status).toBe('SCHEDULED'); // lỗi thì không đổi gì
    expect(h.repos.actions.rows).toHaveLength(0);
  });

  it('việc sau họp: thêm, sửa, xóa do chủ trì; báo xong do người thực hiện hoặc chủ trì; mở lại do chủ trì; việc đã xong không sửa, xóa', async () => {
    started(h);
    await h.service.conclude(actorOf('head'), id, { conclusion: 'Thống nhất' });
    const a = await h.service.addAction(actorOf('head'), id, { content: 'Soạn công văn', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-14' });
    await expect(h.service.addAction(actorOf('staff'), id, { content: 'Tự giao việc', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-14' })).rejects.toBeInstanceOf(ForbiddenException);
    const edited = await h.service.updateAction(actorOf('head'), id, a.id, { dueDate: '2026-10-16', assigneePersonId: PEOPLE.other });
    expect(edited).toMatchObject({ dueDate: '2026-10-16', assigneePersonId: PEOPLE.other });
    await expect(h.service.completeAction(actorOf('staff'), id, a.id)).rejects.toBeInstanceOf(ForbiddenException); // không còn là người thực hiện
    const done = await h.service.completeAction(actorOf('other'), id, a.id);
    expect(done).toMatchObject({ status: 'DONE', completedOn: '2026-10-12' });
    await expect(h.service.completeAction(actorOf('other'), id, a.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.updateAction(actorOf('head'), id, a.id, { content: 'Sửa' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.deleteAction(actorOf('head'), id, a.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.reopenAction(actorOf('other'), id, a.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect((await h.service.reopenAction(actorOf('head'), id, a.id)).status).toBe('PENDING');
    await h.service.deleteAction(actorOf('head'), id, a.id);
    expect(h.repos.actions.rows).toHaveLength(0);
    await expect(h.service.deleteAction(actorOf('head'), id, a.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chưa họp thì chưa có việc sau họp; việc của họp khác không thao tác chéo', async () => {
    await expect(h.service.addAction(actorOf('head'), id, { content: 'Việc sớm', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-14' })).rejects.toBeInstanceOf(ConflictException);
    started(h);
    await h.service.conclude(actorOf('head'), id, { conclusion: 'Xong', actions: [{ content: 'Làm việc A', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-14' }] });
    const other = (await seedMeeting(h, 'head', { title: 'Họp khác', startAt: vn('2026-10-12', '14:00'), endAt: vn('2026-10-12', '15:00') })).meeting.id;
    h.clock.current = new Date('2026-10-12T08:00:00Z');
    await h.service.conclude(actorOf('head'), other, { conclusion: 'Xong' });
    await expect(h.service.completeAction(actorOf('head'), other, h.repos.actions.rows[0].id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sửa kết luận sau khi họp; việc của tôi: chỉ việc còn mở của cuộc họp đã họp, quá hạn đứng đầu', async () => {
    started(h);
    await h.service.conclude(actorOf('head'), id, {
      conclusion: 'Thống nhất',
      actions: [
        { content: 'Việc hạn sau', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-30' },
        { content: 'Việc hạn gần', assigneePersonId: PEOPLE.staff, dueDate: '2026-10-13' },
        { content: 'Việc của người khác', assigneePersonId: PEOPLE.other, dueDate: '2026-10-13' },
      ],
    });
    expect((await h.service.updateConclusion(actorOf('head'), id, 'Kết luận đã chỉnh')).conclusion).toBe('Kết luận đã chỉnh');
    await expect(h.service.updateConclusion(actorOf('staff'), id, 'Tự sửa')).rejects.toBeInstanceOf(ForbiddenException);
    h.clock.current = new Date('2026-10-20T03:00:00Z');
    const mine = await h.service.myActions(actorOf('staff'));
    expect(mine.map((m) => [m.action.content, m.overdue])).toEqual([['Việc hạn gần', true], ['Việc hạn sau', false]]);
    expect(mine[0].meetingTitle).toBe('Họp giao ban tuần');
    expect(await h.service.myActions(actorOf(null))).toEqual([]);
  });
});

describe('MeetingService: biên bản đính kèm', () => {
  let h: Harness;
  let id: string;
  beforeEach(async () => {
    h = await buildMeeting();
    id = (await seedMeeting(h)).meeting.id;
  });
  const pdf = { originalName: 'bien-ban.pdf', size: 9, buffer: Buffer.from('%PDF-1.4 x') };

  it('chủ trì hoặc người tạo tải lên; người được mời tải về; người ngoài không; ghi nhật ký; không lộ khóa lưu trữ', async () => {
    const att = await h.service.upload(actorOf('head'), id, pdf);
    expect(att).toMatchObject({ fileName: 'bien-ban.pdf', contentType: 'application/pdf' });
    expect((att as unknown as { storageKey?: string }).storageKey).toBeUndefined();
    await expect(h.service.upload(actorOf('staff'), id, pdf)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.upload(actorOf('head'), id, { originalName: 'x.exe', size: 2, buffer: Buffer.from('MZ') })).rejects.toBeInstanceOf(BadRequestException);
    expect((await h.service.download(actorOf('staff'), id, att.id, CAPS.staff)).data.toString()).toBe('%PDF-1.4 x');
    await expect(h.service.download(actorOf('outsider'), id, att.id, CAPS.outsider)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.download(actorOf('head'), id, 'khong-co', CAPS.head)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['meeting.attachment.upload', 'meeting.attachment.download']));
  });

  it('cuộc họp đã hủy không đính kèm thêm được', async () => {
    await h.service.cancel(actorOf('head'), id, 'Hoãn');
    await expect(h.service.upload(actorOf('head'), id, pdf)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MeetingService: phòng họp', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildMeeting();
  });

  it('danh sách chọn chỉ có phòng đang dùng, sắp theo tên; phòng ngừng chỉ hiện khi quản lý', async () => {
    expect((await h.service.listRooms()).map((r) => r.name)).toEqual(['Phòng họp số 1', 'Phòng họp số 2']);
    expect((await h.service.listRooms(true)).map((r) => r.name)).toContain('Phòng họp cũ');
  });

  it('chọn phòng: địa điểm lấy theo tên phòng; chữ địa điểm tự gõ bị bỏ qua khi đã chọn phòng', async () => {
    const { meeting } = await seedMeeting(h, 'head', { roomId: 'rm-1', location: 'Gõ tay' });
    expect(meeting).toMatchObject({ roomId: 'rm-1', location: 'Phòng họp số 1' });
    const free = await seedMeeting(h, 'head', { title: 'Họp ngoài', startAt: vn('2026-10-13', '09:00'), endAt: vn('2026-10-13', '10:00'), location: 'Hội trường Tỉnh ủy' });
    expect(free.meeting).toMatchObject({ roomId: null, location: 'Hội trường Tỉnh ủy' });
  });

  it('phòng không có hoặc đã ngừng sử dụng thì không chọn được', async () => {
    await expect(seedMeeting(h, 'head', { roomId: 'rm-khong-co' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(seedMeeting(h, 'head', { roomId: 'rm-old' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('cảnh báo trùng phòng: cùng phòng, giờ chồng lên, cuộc họp còn hiệu lực; tên chỉ hiện nếu xem được', async () => {
    await seedMeeting(h, 'head', { roomId: 'rm-1', title: 'Họp phòng A' });
    const second = await seedMeeting(h, 'outsider', { roomId: 'rm-1', title: 'Họp phòng B', startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00'), attendees: [] });
    expect(second.roomConflicts).toHaveLength(1);
    expect(second.roomConflicts[0]).toMatchObject({ title: null, meetingId: null }); // outsider không xem được họp của head
    const asHead = await h.service.checkRoom(actorOf('head'), CAPS.head, { roomId: 'rm-1', startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00') });
    expect(asHead.map((c) => c.title).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(['Họp phòng A', null]);
    expect(await h.service.checkRoom(actorOf('head'), CAPS.head, { roomId: 'rm-2', startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00') })).toEqual([]); // phòng khác
    expect(await h.service.checkRoom(actorOf('head'), CAPS.head, { roomId: 'rm-1', startAt: vn('2026-10-12', '10:30'), endAt: vn('2026-10-12', '11:00') })).toHaveLength(1); // họp B vẫn ở phòng này; họp A kết thúc 10:30
    await h.service.cancel(actorOf('outsider'), second.meeting.id, 'Đổi phòng');
    expect((await h.service.checkRoom(actorOf('head'), CAPS.head, { roomId: 'rm-1', startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00') })).map((c) => c.title)).toEqual(['Họp phòng A']);
    await expect(h.service.checkRoom(actorOf(null), { readAll: false }, { roomId: 'rm-1', startAt: vn('2026-10-12', '10:00'), endAt: vn('2026-10-12', '11:00') })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sửa cuộc họp: đổi sang phòng khác, bỏ phòng (về chữ tự do), giữ phòng đã ngừng của chính nó', async () => {
    const { meeting } = await seedMeeting(h, 'head', { roomId: 'rm-1' });
    expect((await h.service.update(actorOf('head'), CAPS.head, meeting.id, { roomId: 'rm-2' })).meeting).toMatchObject({ roomId: 'rm-2', location: 'Phòng họp số 2' });
    const freed = (await h.service.update(actorOf('head'), CAPS.head, meeting.id, { roomId: null, location: 'Hội trường' })).meeting;
    expect(freed).toMatchObject({ roomId: null, location: 'Hội trường' });
    await h.service.update(actorOf('head'), CAPS.head, meeting.id, { roomId: 'rm-1' });
    await h.service.updateRoom(actorOf('boss'), 'rm-1', { status: 'INACTIVE' });
    expect((await h.service.update(actorOf('head'), CAPS.head, meeting.id, { title: 'Đổi tiêu đề' })).meeting).toMatchObject({ roomId: 'rm-1', location: 'Phòng họp số 1' }); // không đụng tới phòng
    expect((await h.service.update(actorOf('head'), CAPS.head, meeting.id, { roomId: 'rm-1' })).meeting.roomId).toBe('rm-1'); // đã gắn từ trước nên giữ được
  });

  it('đổi phòng thì báo người được mời (thay đổi nơi họp)', async () => {
    const { meeting } = await seedMeeting(h, 'head', { roomId: 'rm-1' });
    h.notifier.sent.length = 0;
    await h.service.update(actorOf('head'), CAPS.head, meeting.id, { roomId: 'rm-2' });
    expect(h.notifier.of('MEETING_CHANGED')).toHaveLength(1);
  });

  it('chi tiết cuộc họp có thông tin phòng và cảnh báo trùng phòng', async () => {
    const a = await seedMeeting(h, 'head', { roomId: 'rm-1' });
    await seedMeeting(h, 'head', { roomId: 'rm-1', title: 'Họp trùng phòng', attendees: [] });
    const detail = await h.service.get(actorOf('head'), a.meeting.id, CAPS.head);
    expect(detail.room).toMatchObject({ id: 'rm-1', name: 'Phòng họp số 1', capacity: 30 });
    expect(detail.roomConflicts.map((c) => c.title)).toEqual(['Họp trùng phòng']);
  });

  it('quản lý danh mục: thêm, sửa, ngừng sử dụng; tên không trùng (không phân biệt hoa thường); sức chứa hợp lệ; ghi nhật ký', async () => {
    const room = await h.service.createRoom(actorOf('boss'), { name: '  Phòng   họp lớn ', capacity: 50, description: 'Tầng 3' });
    expect(room).toMatchObject({ name: 'Phòng họp lớn', capacity: 50, status: 'ACTIVE' });
    await expect(h.service.createRoom(actorOf('boss'), { name: 'PHÒNG HỌP LỚN' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.createRoom(actorOf('boss'), { name: 'A' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.createRoom(actorOf('boss'), { name: 'Phòng sức chứa sai', capacity: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.createRoom(actorOf('boss'), { name: 'Phòng sức chứa lẻ', capacity: 2.5 })).rejects.toBeInstanceOf(BadRequestException);
    const renamed = await h.service.updateRoom(actorOf('boss'), room.id, { name: 'Phòng họp lớn (tầng 3)', capacity: null });
    expect(renamed).toMatchObject({ name: 'Phòng họp lớn (tầng 3)', capacity: null });
    await expect(h.service.updateRoom(actorOf('boss'), room.id, { name: 'Phòng họp số 1' })).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.updateRoom(actorOf('boss'), room.id, { status: 'X' as never })).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.updateRoom(actorOf('boss'), 'rm-khong-co', { name: 'Tên mới' })).rejects.toBeInstanceOf(NotFoundException);
    expect((await h.service.updateRoom(actorOf('boss'), room.id, { status: 'INACTIVE' })).status).toBe('INACTIVE');
    expect((await h.service.listRooms()).map((r) => r.id)).not.toContain(room.id);
    expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['meeting.room.create', 'meeting.room.update']));
  });

  it('đổi tên phòng không làm đổi địa điểm của cuộc họp đã tạo (giữ bản chụp)', async () => {
    const { meeting } = await seedMeeting(h, 'head', { roomId: 'rm-1' });
    await h.service.updateRoom(actorOf('boss'), 'rm-1', { name: 'Phòng họp Ban Thường vụ' });
    expect((await h.service.get(actorOf('head'), meeting.id, CAPS.head)).meeting.location).toBe('Phòng họp số 1');
  });
});
