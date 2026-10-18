import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import { AuditService } from '../../security/index.js';
import { FileStorage, validateUpload } from '../../tasking/index.js';
import type { UploadedFile } from '../../tasking/index.js';
import { findConflicts } from './meeting-rules.js';
import { MAX_ACTIONS, MAX_ATTACHMENTS, MAX_ATTENDEES, MAX_DURATION_MS, MEETING_STATUSES, ROOM_STATUSES } from './meeting.model.js';
import type { ActionModel, AttendeeModel, AttendeeRole, MeetingAttachmentModel, MeetingModel, MeetingPatch, MeetingStatus, Response, RoomModel, RoomStatus } from './meeting.model.js';
import { ActionRepository, AttendeeRepository, MeetingAttachmentRepository, MeetingOrgDirectory, MeetingProjectDirectory, MeetingRepository, RoomRepository } from './meeting.ports.js';

export interface Actor {
  id: string;
  username: string;
  personId: string | null;
}

export interface Caps {
  /** Xem mọi cuộc họp (Văn phòng, Trưởng ban). */
  readAll: boolean;
}

export interface AttendeeInput {
  personId: string;
  role?: 'REQUIRED' | 'OPTIONAL';
}

export interface MeetingInput {
  title: string;
  agenda?: string | null;
  startAt: string;
  endAt: string;
  location?: string | null;
  onlineLink?: string | null;
  /** Phòng họp trong danh mục; có thì địa điểm lấy theo tên phòng. */
  roomId?: string | null;
  organizerPersonId?: string;
  attendees?: AttendeeInput[];
  projectId?: string | null;
}

export interface RoomInput {
  name: string;
  capacity?: number | null;
  description?: string | null;
  status?: RoomStatus;
}

export interface ActionInput {
  content: string;
  assigneePersonId: string;
  dueDate: string;
}

export interface ConflictView {
  personId: string;
  personName: string;
  /** null nếu người gọi không xem được cuộc họp kia (chỉ biết là bận). */
  meetingId: string | null;
  title: string | null;
  startAt: Date;
  endAt: Date;
}

/** Cuộc họp khác dùng cùng phòng vào giờ chồng lên; tên chỉ hiện nếu người hỏi xem được cuộc họp đó. */
export interface RoomConflictView {
  meetingId: string | null;
  title: string | null;
  startAt: Date;
  endAt: Date;
}

export interface MeetingRow {
  meeting: MeetingModel;
  organizerName: string;
  attendeeCount: number;
  accepted: number;
  declined: number;
  /** Trả lời của người gọi nếu được mời. */
  myResponse: Response | null;
  myRole: AttendeeRole | null;
  project: { code: string; title: string } | null;
  actionCount: number;
  actionsOpen: number;
}

export interface AttendeeView extends AttendeeModel {
  fullName: string;
}

export interface MeetingDetail {
  meeting: MeetingModel;
  organizerName: string;
  project: { code: string; title: string } | null;
  attendees: AttendeeView[];
  actions: (ActionModel & { assigneeName: string; overdue: boolean })[];
  attachments: Omit<MeetingAttachmentModel, 'storageKey'>[];
  conflicts: ConflictView[];
  room: RoomModel | null;
  roomConflicts: RoomConflictView[];
  myResponse: Response | null;
  can: { edit: boolean; cancel: boolean; respond: boolean; conclude: boolean; manageActions: boolean; upload: boolean };
}

export interface ListFilter {
  /** Khoảng thời gian cần xem: các cuộc họp chồng lên [from, to). */
  from?: string;
  to?: string;
  scope?: 'mine' | 'all';
  projectId?: string;
  status?: MeetingStatus;
}

export interface MyAction {
  action: ActionModel;
  meetingTitle: string;
  overdue: boolean;
}

const isoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const todayVn = (now: Date): string => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const fmtVn = (d: Date): string => {
  const v = new Date(d.getTime() + 7 * 3600_000).toISOString();
  return `${v.slice(11, 16)} ngày ${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
};
const clean = (s: string | null | undefined, max: number, label: string): string | null => {
  const v = s?.trim().replace(/[ \t]+/g, ' ');
  if (!v) return null;
  if (v.length > max) throw new BadRequestException(`${label} tối đa ${max} ký tự`);
  return v;
};

/** Lịch họp (ADR-051). Ai đã gắn với cán bộ đều tạo được; chủ trì và người tạo sửa; người được mời xem và trả lời. */
@Injectable()
export class MeetingService {
  constructor(
    private readonly meetings: MeetingRepository,
    private readonly attendees: AttendeeRepository,
    private readonly actions: ActionRepository,
    private readonly attachments: MeetingAttachmentRepository,
    private readonly rooms: RoomRepository,
    private readonly org: MeetingOrgDirectory,
    private readonly projects: MeetingProjectDirectory,
    private readonly storage: FileStorage,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  // ------------------------------------------------------------------ xem

  async list(actor: Actor, caps: Caps, filter: ListFilter = {}): Promise<MeetingRow[]> {
    const scope = filter.scope ?? 'mine';
    if (scope !== 'mine' && scope !== 'all') throw new BadRequestException('Phạm vi là mine hoặc all');
    if (filter.status !== undefined && !MEETING_STATUSES.includes(filter.status)) throw new BadRequestException(`Trạng thái không hợp lệ: ${filter.status}`);
    const from = filter.from ? this.instant(filter.from, 'from') : null;
    const to = filter.to ? this.instant(filter.to, 'to') : null;
    if (from && to && to <= from) throw new BadRequestException('to phải sau from');

    let rows: MeetingModel[];
    if (scope === 'all') {
      if (!caps.readAll) throw new ForbiddenException('Bạn không có quyền xem toàn bộ lịch họp');
      rows = filter.projectId ? await this.meetings.findByProject(filter.projectId) : await this.meetings.findAll();
    } else {
      const ids = new Set<string>(actor.personId ? await this.attendees.meetingIdsOfPerson(actor.personId) : []);
      const mine = await this.meetings.findByIds([...ids]);
      const created = (await this.meetings.findAll()).filter((m) => m.createdByAccountId === actor.id);
      rows = [...new Map([...mine, ...created].map((m) => [m.id, m])).values()];
      if (filter.projectId) rows = rows.filter((m) => m.projectId === filter.projectId);
    }
    rows = rows.filter((m) => (!filter.status || m.status === filter.status) && (!from || m.endAt > from) && (!to || m.startAt < to));
    rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
    return this.rowsOf(actor, rows);
  }

  async get(actor: Actor, id: string, caps: Caps): Promise<MeetingDetail> {
    const meeting = await this.require(id);
    const attendees = await this.attendees.findByMeetings([id]);
    this.assertCanView(actor, meeting, attendees, caps);
    const [actions, files, lookup, projectLabels] = await Promise.all([
      this.actions.findByMeetings([id]),
      this.attachments.findByMeeting(id),
      this.org.lookup(),
      meeting.projectId ? this.projects.labels([meeting.projectId]) : Promise.resolve(new Map<string, { code: string; title: string }>()),
    ]);
    const name = (pid: string) => lookup.persons.get(pid)?.fullName ?? '(không rõ)';
    const today = todayVn(this.clock.now());
    const editor = this.isEditor(actor, meeting);
    const me = actor.personId ? attendees.find((a) => a.personId === actor.personId) : undefined;
    const scheduled = meeting.status === 'SCHEDULED';
    return {
      meeting,
      organizerName: name(meeting.organizerPersonId),
      project: meeting.projectId ? (projectLabels.get(meeting.projectId) ?? null) : null,
      attendees: attendees
        .map((a) => ({ ...a, fullName: name(a.personId) }))
        .sort((a, b) => rank(a.role) - rank(b.role) || a.fullName.localeCompare(b.fullName, 'vi')),
      actions: actions.map((a) => ({ ...a, assigneeName: name(a.assigneePersonId), overdue: a.status !== 'DONE' && a.dueDate < today })).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      attachments: files.map(({ storageKey: _k, ...rest }) => rest),
      conflicts: scheduled ? await this.conflictsFor(actor, caps, meeting, attendees.filter((a) => a.response !== 'DECLINED').map((a) => a.personId), meeting.id) : [],
      room: meeting.roomId ? await this.rooms.findById(meeting.roomId) : null,
      roomConflicts: scheduled && meeting.roomId ? await this.roomConflictsFor(actor, caps, meeting.roomId, meeting, meeting.id) : [],
      myResponse: me?.response ?? null,
      can: {
        edit: editor && scheduled,
        cancel: editor && scheduled,
        respond: !!me && me.role !== 'ORGANIZER' && scheduled,
        conclude: editor && scheduled && this.clock.now() >= meeting.startAt,
        manageActions: editor && meeting.status === 'HELD',
        upload: editor && meeting.status !== 'CANCELLED',
      },
    };
  }

  /** Xem trước các cuộc họp trùng giờ của những người định mời. Không ghi gì. */
  async checkConflicts(actor: Actor, caps: Caps, input: { startAt: string; endAt: string; attendeePersonIds: string[]; excludeMeetingId?: string }): Promise<ConflictView[]> {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ');
    const slot = this.slot(input.startAt, input.endAt);
    return this.conflictsFor(actor, caps, slot, [...new Set(input.attendeePersonIds)], input.excludeMeetingId);
  }

  /** Xem trước cuộc họp khác dùng cùng phòng vào giờ này. Không ghi gì. */
  async checkRoom(actor: Actor, caps: Caps, input: { roomId: string; startAt: string; endAt: string; excludeMeetingId?: string }): Promise<RoomConflictView[]> {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ');
    await this.requireRoom(input.roomId);
    return this.roomConflictsFor(actor, caps, input.roomId, this.slot(input.startAt, input.endAt), input.excludeMeetingId);
  }

  // ------------------------------------------------------------------ danh mục phòng họp

  /** Phòng họp để chọn; mặc định chỉ phòng đang dùng. */
  async listRooms(includeInactive = false): Promise<RoomModel[]> {
    return (await this.rooms.findAll()).filter((r) => includeInactive || r.status === 'ACTIVE').sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
  }

  async createRoom(actor: Actor, input: RoomInput): Promise<RoomModel> {
    const data = await this.roomData(input);
    const created = await this.rooms.create({ name: data.name, capacity: data.capacity, description: data.description });
    await this.audit.record({ action: 'meeting.room.create', outcome: 'SUCCESS', targetType: 'meeting_room', targetId: created.id, details: { name: created.name, capacity: created.capacity, by: actor.username } });
    return created;
  }

  async updateRoom(actor: Actor, id: string, patch: Partial<RoomInput>): Promise<RoomModel> {
    const room = await this.requireRoom(id);
    const merged = { name: patch.name ?? room.name, capacity: patch.capacity === undefined ? room.capacity : patch.capacity, description: patch.description === undefined ? room.description : patch.description };
    const data = await this.roomData(merged, id);
    const status = patch.status ?? room.status;
    if (!ROOM_STATUSES.includes(status)) throw new BadRequestException('Trạng thái phòng họp là ACTIVE hoặc INACTIVE');
    const updated = await this.rooms.update(id, { ...data, status });
    await this.audit.record({
      action: 'meeting.room.update',
      outcome: 'SUCCESS',
      targetType: 'meeting_room',
      targetId: id,
      details: { before: { name: room.name, capacity: room.capacity, status: room.status }, after: { name: updated.name, capacity: updated.capacity, status: updated.status }, by: actor.username },
    });
    return updated;
  }

  /** Việc sau họp còn mở giao cho người gọi, quá hạn đứng đầu. */
  async myActions(actor: Actor): Promise<MyAction[]> {
    if (!actor.personId) return [];
    const open = (await this.actions.findByAssignee(actor.personId)).filter((a) => a.status !== 'DONE');
    const meetings = new Map((await this.meetings.findByIds([...new Set(open.map((a) => a.meetingId))])).map((m) => [m.id, m]));
    const today = todayVn(this.clock.now());
    return open
      .filter((a) => meetings.get(a.meetingId)?.status === 'HELD')
      .map((action) => ({ action, meetingTitle: meetings.get(action.meetingId)!.title, overdue: action.dueDate < today }))
      .sort((a, b) => a.action.dueDate.localeCompare(b.action.dueDate));
  }

  // ------------------------------------------------------------------ tạo, sửa, hủy

  async create(actor: Actor, caps: Caps, input: MeetingInput): Promise<{ meeting: MeetingModel; conflicts: ConflictView[]; roomConflicts: RoomConflictView[] }> {
    if (!actor.personId) throw new ForbiddenException('Tài khoản chưa gắn với cán bộ nên chưa tạo lịch họp được');
    const fields = { ...this.fields(input), ...(await this.place(input.roomId, input.location)) };
    const organizer = input.organizerPersonId ?? actor.personId;
    const invitees = await this.invitees(organizer, input.attendees ?? []);
    if (input.projectId) await this.projects.viewable(actor, input.projectId);
    const meeting = await this.meetings.create({ ...fields, organizerPersonId: organizer, createdByAccountId: actor.id, projectId: input.projectId ?? null });
    await this.attendees.upsert(meeting.id, organizer, 'ORGANIZER', 'ACCEPTED');
    for (const i of invitees) await this.attendees.upsert(meeting.id, i.personId, i.role, 'PENDING');
    await this.record('meeting.create', meeting, { attendees: invitees.length + 1, projectId: meeting.projectId, roomId: meeting.roomId });
    await this.notifier.notify(
      [organizer, ...invitees.map((i) => i.personId)].filter((p) => p !== actor.personId),
      { type: 'MEETING_INVITED', title: `Mời họp: ${meeting.title} lúc ${fmtVn(meeting.startAt)}`, link: `/meetings/${meeting.id}` },
    );
    const conflicts = await this.conflictsFor(actor, caps, meeting, [organizer, ...invitees.map((i) => i.personId)], meeting.id);
    const roomConflicts = meeting.roomId ? await this.roomConflictsFor(actor, caps, meeting.roomId, meeting, meeting.id) : [];
    return { meeting, conflicts, roomConflicts };
  }

  async update(actor: Actor, caps: Caps, id: string, patch: Partial<MeetingInput>): Promise<{ meeting: MeetingModel; conflicts: ConflictView[]; roomConflicts: RoomConflictView[] }> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['SCHEDULED'], 'sửa');
    const next: MeetingPatch = {};
    const merged = {
      title: patch.title ?? meeting.title,
      agenda: patch.agenda === undefined ? meeting.agenda : patch.agenda,
      startAt: patch.startAt ?? meeting.startAt.toISOString(),
      endAt: patch.endAt ?? meeting.endAt.toISOString(),
      location: patch.location === undefined ? meeting.location : patch.location,
      onlineLink: patch.onlineLink === undefined ? meeting.onlineLink : patch.onlineLink,
    };
    const f = this.fields(merged);
    Object.assign(next, f);
    if (patch.roomId !== undefined || patch.location !== undefined) {
      const place = await this.place(patch.roomId === undefined ? meeting.roomId : patch.roomId, patch.location === undefined ? meeting.location : patch.location, meeting.roomId);
      next.roomId = place.roomId;
      next.location = place.location;
    } else {
      next.location = meeting.location;
    }
    const timeOrPlaceChanged = f.startAt.getTime() !== meeting.startAt.getTime() || f.endAt.getTime() !== meeting.endAt.getTime() || next.location !== meeting.location || f.onlineLink !== meeting.onlineLink;
    const timeChanged = f.startAt.getTime() !== meeting.startAt.getTime() || f.endAt.getTime() !== meeting.endAt.getTime();
    if (patch.projectId !== undefined) {
      if (patch.projectId) await this.projects.viewable(actor, patch.projectId);
      next.projectId = patch.projectId ?? null;
    }

    const current = await this.attendees.findByMeetings([id]);
    const organizer = patch.organizerPersonId ?? meeting.organizerPersonId;
    if (patch.organizerPersonId !== undefined) next.organizerPersonId = organizer;
    const invitedNow: string[] = [];
    let removed: string[] = [];
    if (patch.attendees !== undefined || patch.organizerPersonId !== undefined) {
      const wanted = patch.attendees ?? current.filter((a) => a.role !== 'ORGANIZER').map((a) => ({ personId: a.personId, role: a.role as 'REQUIRED' | 'OPTIONAL' }));
      // Đổi chủ trì: chủ trì cũ ở lại làm người dự (trừ khi đã có trong danh sách).
      if (organizer !== meeting.organizerPersonId && !wanted.some((w) => w.personId === meeting.organizerPersonId)) wanted.push({ personId: meeting.organizerPersonId, role: 'REQUIRED' });
      const invitees = await this.invitees(organizer, wanted);
      const keep = new Set([organizer, ...invitees.map((i) => i.personId)]);
      removed = current.filter((a) => !keep.has(a.personId)).map((a) => a.personId);
      for (const pid of removed) await this.attendees.remove(id, pid);
      const known = new Map(current.map((a) => [a.personId, a]));
      for (const i of invitees) {
        const had = known.get(i.personId);
        if (!had) invitedNow.push(i.personId);
        await this.attendees.upsert(id, i.personId, i.role, had && had.role !== 'ORGANIZER' ? had.response : 'PENDING');
      }
      await this.attendees.upsert(id, organizer, 'ORGANIZER', 'ACCEPTED');
    }
    if (timeChanged) await this.attendees.resetResponses(id, [organizer, ...invitedNow]);
    const updated = await this.meetings.update(id, next);
    await this.record('meeting.update', updated, {
      before: { title: meeting.title, startAt: meeting.startAt, endAt: meeting.endAt, location: meeting.location },
      after: { title: updated.title, startAt: updated.startAt, endAt: updated.endAt, location: updated.location },
      invited: invitedNow.length,
      removed: removed.length,
    });
    const after = await this.attendees.findByMeetings([id]);
    const notifyChanged = after.map((a) => a.personId).filter((p) => p !== actor.personId && !invitedNow.includes(p));
    if (timeOrPlaceChanged || patch.title !== undefined) {
      await this.notifier.notify(notifyChanged, { type: 'MEETING_CHANGED', title: `Cuộc họp thay đổi: ${updated.title}, nay lúc ${fmtVn(updated.startAt)}`, link: `/meetings/${id}` });
    }
    await this.notifier.notify(invitedNow.filter((p) => p !== actor.personId), { type: 'MEETING_INVITED', title: `Mời họp: ${updated.title} lúc ${fmtVn(updated.startAt)}`, link: `/meetings/${id}` });
    await this.notifier.notify(removed.filter((p) => p !== actor.personId), { type: 'MEETING_CHANGED', title: `Bạn không còn trong thành phần cuộc họp: ${updated.title}` });
    const conflicts = await this.conflictsFor(actor, caps, updated, after.filter((a) => a.response !== 'DECLINED').map((a) => a.personId), id);
    const roomConflicts = updated.roomId ? await this.roomConflictsFor(actor, caps, updated.roomId, updated, id) : [];
    return { meeting: updated, conflicts, roomConflicts };
  }

  async cancel(actor: Actor, id: string, reason: string): Promise<MeetingModel> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['SCHEDULED'], 'hủy');
    const why = clean(reason, 1000, 'Lý do');
    if (!why || why.length < 3) throw new BadRequestException('Cần nêu lý do hủy (ít nhất 3 ký tự)');
    const updated = await this.meetings.update(id, { status: 'CANCELLED', cancelReason: why });
    await this.record('meeting.cancel', updated, { reason: why });
    const people = (await this.attendees.findByMeetings([id])).map((a) => a.personId).filter((p) => p !== actor.personId);
    await this.notifier.notify(people, { type: 'MEETING_CANCELLED', title: `Hủy họp: ${updated.title} (${fmtVn(updated.startAt)})`, link: `/meetings/${id}` });
    return updated;
  }

  // ------------------------------------------------------------------ trả lời lời mời

  async respond(actor: Actor, id: string, input: { response: Response; note?: string | null }): Promise<AttendeeModel> {
    const meeting = await this.require(id);
    this.assertStatus(meeting, ['SCHEDULED'], 'trả lời');
    if (input.response !== 'ACCEPTED' && input.response !== 'DECLINED') throw new BadRequestException('Trả lời là ACCEPTED hoặc DECLINED');
    const me = actor.personId ? (await this.attendees.findByMeetings([id])).find((a) => a.personId === actor.personId) : undefined;
    if (!me) throw new ForbiddenException('Bạn không có trong thành phần cuộc họp này');
    if (me.role === 'ORGANIZER') throw new ConflictException('Chủ trì mặc nhiên tham dự');
    const note = clean(input.note, 500, 'Ghi chú');
    if (input.response === 'DECLINED' && (note?.length ?? 0) < 3) throw new BadRequestException('Cần nêu lý do khi từ chối (ít nhất 3 ký tự)');
    await this.attendees.respond(id, actor.personId!, input.response, note, this.clock.now());
    await this.record('meeting.respond', meeting, { response: input.response, personId: actor.personId });
    await this.notifier.notify([meeting.organizerPersonId], {
      type: 'MEETING_RESPONDED',
      title: `${input.response === 'DECLINED' ? 'Từ chối' : 'Xác nhận'} họp: ${(await this.org.lookup()).persons.get(actor.personId!)?.fullName ?? 'cán bộ'}, ${meeting.title}`,
      link: `/meetings/${id}`,
    });
    return (await this.attendees.findByMeetings([id])).find((a) => a.personId === actor.personId)!;
  }

  // ------------------------------------------------------------------ kết luận và việc sau họp

  /** Kết thúc cuộc họp: ghi kết luận, người có mặt và các việc sau họp. Chỉ sau giờ bắt đầu. */
  async conclude(actor: Actor, id: string, input: { conclusion: string; attendedPersonIds?: string[]; actions?: ActionInput[] }): Promise<MeetingModel> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['SCHEDULED'], 'kết thúc');
    if (this.clock.now() < meeting.startAt) throw new ConflictException('Chưa đến giờ họp nên chưa kết thúc được');
    const conclusion = clean(input.conclusion, 8000, 'Kết luận');
    if (!conclusion || conclusion.length < 3) throw new BadRequestException('Cần ghi kết luận (ít nhất 3 ký tự)');
    const all = await this.attendees.findByMeetings([id]);
    const attended = input.attendedPersonIds ?? all.filter((a) => a.response === 'ACCEPTED').map((a) => a.personId);
    const known = new Set(all.map((a) => a.personId));
    if (attended.some((p) => !known.has(p))) throw new BadRequestException('Người có mặt phải thuộc thành phần cuộc họp');
    const acts = input.actions ?? [];
    if (acts.length > MAX_ACTIONS) throw new ConflictException(`Tối đa ${MAX_ACTIONS} việc sau họp`);
    for (const a of acts) await this.assertActionInput(a, meeting);
    await this.attendees.setAttended(id, attended);
    const updated = await this.meetings.update(id, { status: 'HELD', conclusion, concludedAt: this.clock.now() });
    for (const a of acts) await this.createAction(actor, updated, a);
    await this.record('meeting.conclude', updated, { attended: attended.length, actions: acts.length });
    return updated;
  }

  async updateConclusion(actor: Actor, id: string, conclusion: string): Promise<MeetingModel> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['HELD'], 'sửa kết luận');
    const text = clean(conclusion, 8000, 'Kết luận');
    if (!text || text.length < 3) throw new BadRequestException('Cần ghi kết luận (ít nhất 3 ký tự)');
    const updated = await this.meetings.update(id, { conclusion: text });
    await this.record('meeting.update', updated, { field: 'conclusion' });
    return updated;
  }

  async addAction(actor: Actor, id: string, input: ActionInput): Promise<ActionModel> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['HELD'], 'thêm việc sau họp');
    if ((await this.actions.findByMeetings([id])).length >= MAX_ACTIONS) throw new ConflictException(`Tối đa ${MAX_ACTIONS} việc sau họp`);
    await this.assertActionInput(input, meeting);
    return this.createAction(actor, meeting, input);
  }

  async updateAction(actor: Actor, id: string, actionId: string, input: Partial<ActionInput>): Promise<ActionModel> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['HELD'], 'sửa việc sau họp');
    const a = await this.requireAction(id, actionId);
    if (a.status === 'DONE') throw new ConflictException('Việc đã hoàn thành: hãy mở lại trước khi sửa');
    const merged = { content: input.content ?? a.content, assigneePersonId: input.assigneePersonId ?? a.assigneePersonId, dueDate: input.dueDate ?? a.dueDate };
    await this.assertActionInput(merged, meeting);
    const updated = await this.actions.update(actionId, merged);
    await this.record('meeting.action.update', meeting, { actionId, before: { assigneePersonId: a.assigneePersonId, dueDate: a.dueDate }, after: { assigneePersonId: merged.assigneePersonId, dueDate: merged.dueDate } });
    if (merged.assigneePersonId !== a.assigneePersonId && merged.assigneePersonId !== actor.personId) {
      await this.notifier.notify([merged.assigneePersonId], { type: 'MEETING_ACTION_ASSIGNED', title: `Việc sau họp "${merged.content.slice(0, 80)}" (${meeting.title}), hạn ${merged.dueDate}`, link: `/meetings/${id}` });
    }
    return updated;
  }

  async deleteAction(actor: Actor, id: string, actionId: string): Promise<void> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['HELD'], 'xóa việc sau họp');
    const a = await this.requireAction(id, actionId);
    if (a.status === 'DONE') throw new ConflictException('Việc đã hoàn thành, không xóa được');
    await this.actions.delete(actionId);
    await this.record('meeting.action.remove', meeting, { actionId });
  }

  /** Báo việc sau họp xong: người được giao hoặc chủ trì cuộc họp. */
  async completeAction(actor: Actor, id: string, actionId: string): Promise<ActionModel> {
    const meeting = await this.require(id);
    this.assertStatus(meeting, ['HELD'], 'báo hoàn thành việc');
    const a = await this.requireAction(id, actionId);
    if (!this.isEditor(actor, meeting) && !(actor.personId && actor.personId === a.assigneePersonId)) throw new ForbiddenException('Chỉ người được giao hoặc chủ trì mới báo hoàn thành');
    if (a.status === 'DONE') throw new ConflictException('Việc đã hoàn thành');
    const updated = await this.actions.update(actionId, { status: 'DONE', completedOn: todayVn(this.clock.now()) });
    await this.record('meeting.action.done', meeting, { actionId, late: updated.completedOn! > a.dueDate });
    if (actor.personId !== meeting.organizerPersonId) {
      await this.notifier.notify([meeting.organizerPersonId], { type: 'MEETING_ACTION_ASSIGNED', title: `Đã xong việc sau họp: ${a.content.slice(0, 80)} (${meeting.title})`, link: `/meetings/${id}` });
    }
    return updated;
  }

  async reopenAction(actor: Actor, id: string, actionId: string): Promise<ActionModel> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    this.assertStatus(meeting, ['HELD'], 'mở lại việc');
    const a = await this.requireAction(id, actionId);
    if (a.status !== 'DONE') throw new ConflictException('Việc chưa hoàn thành');
    const updated = await this.actions.update(actionId, { status: 'PENDING', completedOn: null });
    await this.record('meeting.action.reopen', meeting, { actionId });
    return updated;
  }

  // ------------------------------------------------------------------ biên bản đính kèm

  async upload(actor: Actor, id: string, file: UploadedFile): Promise<Omit<MeetingAttachmentModel, 'storageKey'>> {
    const meeting = await this.require(id);
    this.assertEditor(actor, meeting);
    if (meeting.status === 'CANCELLED') throw new ConflictException('Cuộc họp đã hủy, không đính kèm thêm được');
    if ((await this.attachments.findByMeeting(id)).length >= MAX_ATTACHMENTS) throw new ConflictException(`Tối đa ${MAX_ATTACHMENTS} tệp mỗi cuộc họp`);
    const { fileName, contentType } = validateUpload(file);
    const key = `meetings/${id}/${randomUUID()}`;
    await this.storage.put(key, file.buffer, contentType);
    const { storageKey: _k, ...created } = await this.attachments.create({ meetingId: id, fileName, contentType, sizeBytes: file.size, storageKey: key, uploadedByAccountId: actor.id });
    await this.record('meeting.attachment.upload', meeting, { attachmentId: created.id, fileName, sizeBytes: file.size });
    return created;
  }

  async download(actor: Actor, id: string, attachmentId: string, caps: Caps): Promise<{ attachment: MeetingAttachmentModel; data: Buffer }> {
    const meeting = await this.require(id);
    this.assertCanView(actor, meeting, await this.attendees.findByMeetings([id]), caps);
    const attachment = await this.attachments.findById(attachmentId);
    if (!attachment || attachment.meetingId !== id) throw new NotFoundException('Không tìm thấy tệp đính kèm');
    const data = await this.storage.get(attachment.storageKey);
    await this.record('meeting.attachment.download', meeting, { attachmentId, fileName: attachment.fileName, sizeBytes: attachment.sizeBytes });
    return { attachment, data };
  }

  // ------------------------------------------------------------------ nội bộ

  private async rowsOf(actor: Actor, rows: MeetingModel[]): Promise<MeetingRow[]> {
    const ids = rows.map((m) => m.id);
    const [attendees, actions, lookup, labels] = await Promise.all([
      this.attendees.findByMeetings(ids),
      this.actions.findByMeetings(ids),
      this.org.lookup(),
      this.projects.labels([...new Set(rows.flatMap((m) => (m.projectId ? [m.projectId] : [])))]),
    ]);
    return rows.map((meeting) => {
      const people = attendees.filter((a) => a.meetingId === meeting.id);
      const me = actor.personId ? people.find((a) => a.personId === actor.personId) : undefined;
      const acts = actions.filter((a) => a.meetingId === meeting.id);
      return {
        meeting,
        organizerName: lookup.persons.get(meeting.organizerPersonId)?.fullName ?? '(không rõ)',
        attendeeCount: people.length,
        accepted: people.filter((a) => a.response === 'ACCEPTED').length,
        declined: people.filter((a) => a.response === 'DECLINED').length,
        myResponse: me?.response ?? null,
        myRole: me?.role ?? null,
        project: meeting.projectId ? (labels.get(meeting.projectId) ?? null) : null,
        actionCount: acts.length,
        actionsOpen: acts.filter((a) => a.status !== 'DONE').length,
      };
    });
  }

  /** Cuộc họp khác trùng giờ của những người nêu; tên cuộc họp chỉ hiện nếu người gọi xem được cuộc họp đó. */
  private async conflictsFor(actor: Actor, caps: Caps, slot: { startAt: Date; endAt: Date }, personIds: string[], excludeMeetingId?: string): Promise<ConflictView[]> {
    if (personIds.length === 0) return [];
    const overlapping = (await this.meetings.findOverlapping(slot.startAt, slot.endAt)).filter((m) => m.status === 'SCHEDULED');
    const attendees = await this.attendees.findByMeetings(overlapping.map((m) => m.id));
    const found = findConflicts(slot, personIds, overlapping, attendees, excludeMeetingId);
    const lookup = await this.org.lookup();
    const byMeeting = new Map(overlapping.map((m) => [m.id, m]));
    return found.map((c) => {
      const m = byMeeting.get(c.meetingId)!;
      const visible = this.canView(actor, m, attendees.filter((a) => a.meetingId === m.id), caps);
      return { personId: c.personId, personName: lookup.persons.get(c.personId)?.fullName ?? '(không rõ)', meetingId: visible ? m.id : null, title: visible ? m.title : null, startAt: c.startAt, endAt: c.endAt };
    });
  }

  /** Cuộc họp khác dùng cùng phòng vào giờ chồng lên (chưa họp, chưa hủy); tên chỉ hiện nếu người hỏi xem được. */
  private async roomConflictsFor(actor: Actor, caps: Caps, roomId: string, slot: { startAt: Date; endAt: Date }, excludeMeetingId?: string): Promise<RoomConflictView[]> {
    const same = (await this.meetings.findOverlapping(slot.startAt, slot.endAt)).filter((m) => m.roomId === roomId && m.status === 'SCHEDULED' && m.id !== excludeMeetingId);
    if (same.length === 0) return [];
    const attendees = await this.attendees.findByMeetings(same.map((m) => m.id));
    return same.map((m) => {
      const visible = this.canView(actor, m, attendees.filter((a) => a.meetingId === m.id), caps);
      return { meetingId: visible ? m.id : null, title: visible ? m.title : null, startAt: m.startAt, endAt: m.endAt };
    });
  }

  /** Địa điểm: chọn phòng trong danh mục thì lấy tên phòng (giữ bản chụp để đổi tên phòng sau này không làm đổi lịch sử); không thì chữ tự do. */
  private async place(roomId: string | null | undefined, location: string | null | undefined, currentRoomId: string | null = null): Promise<{ roomId: string | null; location: string | null }> {
    if (!roomId) return { roomId: null, location: clean(location, 300, 'Địa điểm') };
    const room = await this.requireRoom(roomId);
    if (room.status !== 'ACTIVE' && room.id !== currentRoomId) throw new ConflictException(`Phòng "${room.name}" đã ngừng sử dụng`);
    return { roomId: room.id, location: room.name };
  }

  private async requireRoom(id: string): Promise<RoomModel> {
    const room = await this.rooms.findById(id);
    if (!room) throw new NotFoundException(`Không tìm thấy phòng họp: ${id}`);
    return room;
  }

  private async roomData(input: RoomInput, selfId?: string): Promise<{ name: string; capacity: number | null; description: string | null }> {
    const name = input.name?.trim().replace(/\s+/g, ' ') ?? '';
    if (name.length < 2 || name.length > 100) throw new BadRequestException('Tên phòng họp dài từ 2 đến 100 ký tự');
    const same = await this.rooms.findByName(name);
    if (same && same.id !== selfId) throw new ConflictException(`Đã có phòng họp tên "${same.name}"`);
    const capacity = input.capacity ?? null;
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000)) throw new BadRequestException('Sức chứa là số nguyên từ 1 đến 10000');
    return { name, capacity, description: clean(input.description, 500, 'Ghi chú') };
  }

  private async require(id: string): Promise<MeetingModel> {
    const m = await this.meetings.findById(id);
    if (!m) throw new NotFoundException(`Không tìm thấy cuộc họp: ${id}`);
    return m;
  }

  private async requireAction(meetingId: string, actionId: string): Promise<ActionModel> {
    const a = await this.actions.findById(actionId);
    if (!a || a.meetingId !== meetingId) throw new NotFoundException('Không tìm thấy việc sau họp');
    return a;
  }

  private isEditor(actor: Actor, m: MeetingModel): boolean {
    return actor.id === m.createdByAccountId || (!!actor.personId && actor.personId === m.organizerPersonId);
  }

  private assertEditor(actor: Actor, m: MeetingModel): void {
    if (!this.isEditor(actor, m)) throw new ForbiddenException('Chỉ chủ trì hoặc người tạo cuộc họp mới thực hiện được thao tác này');
  }

  private canView(actor: Actor, m: MeetingModel, attendees: readonly AttendeeModel[], caps: Caps): boolean {
    return caps.readAll || this.isEditor(actor, m) || (!!actor.personId && attendees.some((a) => a.personId === actor.personId));
  }

  private assertCanView(actor: Actor, m: MeetingModel, attendees: readonly AttendeeModel[], caps: Caps): void {
    if (!this.canView(actor, m, attendees, caps)) throw new ForbiddenException('Bạn không có quyền xem cuộc họp này');
  }

  private assertStatus(m: MeetingModel, allowed: MeetingStatus[], action: string): void {
    const text: Record<MeetingStatus, string> = { SCHEDULED: 'chưa họp', HELD: 'đã họp', CANCELLED: 'đã hủy' };
    if (!allowed.includes(m.status)) throw new ConflictException(`Cuộc họp ${text[m.status]}, không ${action} được`);
  }

  private instant(value: unknown, label: string): Date {
    const d = typeof value === 'string' && /\d{2}:\d{2}/.test(value) ? new Date(value) : new Date(Number.NaN);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} phải là thời điểm hợp lệ (ISO 8601 kèm múi giờ)`);
    return d;
  }

  private slot(startAt: string, endAt: string): { startAt: Date; endAt: Date } {
    const s = this.instant(startAt, 'Giờ bắt đầu');
    const e = this.instant(endAt, 'Giờ kết thúc');
    if (e <= s) throw new BadRequestException('Giờ kết thúc phải sau giờ bắt đầu');
    if (e.getTime() - s.getTime() > MAX_DURATION_MS) throw new BadRequestException('Một cuộc họp tối đa 12 giờ');
    return { startAt: s, endAt: e };
  }

  private fields(input: { title: string; agenda?: string | null; startAt: string; endAt: string; onlineLink?: string | null }) {
    const title = input.title?.trim().replace(/\s+/g, ' ') ?? '';
    if (title.length < 3 || title.length > 200) throw new BadRequestException('Tiêu đề dài từ 3 đến 200 ký tự');
    const link = clean(input.onlineLink, 500, 'Đường dẫn họp trực tuyến');
    if (link && !/^https?:\/\/[^\s]+$/i.test(link)) throw new BadRequestException('Đường dẫn họp trực tuyến phải bắt đầu bằng http:// hoặc https://');
    return { title, agenda: clean(input.agenda, 8000, 'Nội dung họp'), onlineLink: link, ...this.slot(input.startAt, input.endAt) };
  }

  /** Danh sách người được mời đã kiểm tra: không trùng, không gồm chủ trì, đều là cán bộ còn được quản lý. */
  private async invitees(organizer: string, input: AttendeeInput[]): Promise<{ personId: string; role: 'REQUIRED' | 'OPTIONAL' }[]> {
    const map = new Map<string, 'REQUIRED' | 'OPTIONAL'>();
    for (const a of input) {
      if (a.role !== undefined && a.role !== 'REQUIRED' && a.role !== 'OPTIONAL') throw new BadRequestException('Vai trò người dự là REQUIRED hoặc OPTIONAL');
      if (a.personId !== organizer) map.set(a.personId, a.role ?? 'REQUIRED');
    }
    if (map.size + 1 > MAX_ATTENDEES) throw new ConflictException(`Tối đa ${MAX_ATTENDEES} người dự`);
    const wanted = [organizer, ...map.keys()];
    const active = await this.org.activePersonIds(wanted);
    const missing = wanted.filter((p) => !active.has(p));
    if (missing.length > 0) throw new BadRequestException('Có cán bộ không tồn tại hoặc không còn được quản lý trong thành phần cuộc họp');
    return [...map].map(([personId, role]) => ({ personId, role }));
  }

  private async assertActionInput(input: ActionInput, meeting: MeetingModel): Promise<void> {
    const content = input.content?.trim() ?? '';
    if (content.length < 3 || content.length > 1000) throw new BadRequestException('Nội dung việc dài từ 3 đến 1000 ký tự');
    if (!isoDate(input.dueDate)) throw new BadRequestException('Hạn có dạng YYYY-MM-DD');
    if (input.dueDate < todayVn(meeting.startAt)) throw new BadRequestException('Hạn không được trước ngày họp');
    const all = await this.attendees.findByMeetings([meeting.id]);
    if (!all.some((a) => a.personId === input.assigneePersonId)) throw new BadRequestException('Người thực hiện phải thuộc thành phần cuộc họp');
  }

  private async createAction(actor: Actor, meeting: MeetingModel, input: ActionInput): Promise<ActionModel> {
    const created = await this.actions.create({ meetingId: meeting.id, content: input.content.trim().replace(/\s+/g, ' '), assigneePersonId: input.assigneePersonId, dueDate: input.dueDate });
    await this.record('meeting.action.add', meeting, { actionId: created.id, assigneePersonId: created.assigneePersonId, dueDate: created.dueDate });
    if (created.assigneePersonId !== actor.personId) {
      await this.notifier.notify([created.assigneePersonId], { type: 'MEETING_ACTION_ASSIGNED', title: `Việc sau họp "${created.content.slice(0, 80)}" (${meeting.title}), hạn ${created.dueDate}`, link: `/meetings/${meeting.id}` });
    }
    return created;
  }

  private async record(action: string, meeting: MeetingModel, details: Record<string, unknown>): Promise<void> {
    await this.audit.record({ action, outcome: 'SUCCESS', targetType: 'meeting', targetId: meeting.id, details: { title: meeting.title, ...details } });
  }
}

const rank = (r: AttendeeRole): number => (r === 'ORGANIZER' ? 0 : r === 'REQUIRED' ? 1 : 2);

export { MAX_ATTENDEES };
export type { MeetingPatch };
