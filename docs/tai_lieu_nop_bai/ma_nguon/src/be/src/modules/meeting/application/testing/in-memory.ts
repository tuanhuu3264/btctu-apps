import { Test } from '@nestjs/testing';
import { Clock } from '../../../../common/clock.js';
import { Notifier } from '../../../../common/notifier.js';
import { FakeNotifier } from '../../../../common/testing/fake-notifier.js';
import { AuditService } from '../../../security/index.js';
import { FileStorage } from '../../../tasking/index.js';
import type { ActionModel, ActionPatch, AttendeeModel, AttendeeRole, MeetingAttachmentModel, MeetingModel, MeetingPatch, NewAction, NewMeeting, NewMeetingAttachment, NewRoom, Response, RoomModel, RoomPatch } from '../meeting.model.js';
import { ActionRepository, AttendeeRepository, MeetingAttachmentRepository, MeetingOrgDirectory, MeetingProjectDirectory, MeetingRepository, RoomRepository } from '../meeting.ports.js';
import { MeetingService } from '../meeting.service.js';
import type { Actor, Caps, MeetingInput } from '../meeting.service.js';

/** Đối tượng giả dùng chung cho test lớp nghiệp vụ của mô-đun meeting. */
export const PEOPLE = { boss: 'p-boss', head: 'p-head', staff: 'p-staff', other: 'p-other', outsider: 'p-outsider', gone: 'p-gone' } as const;
export type Who = keyof typeof PEOPLE;

export const actorOf = (who: Who | null): Actor => (who === null ? { id: 'acc-none', username: 'none', personId: null } : { id: `acc-${who}`, username: who, personId: PEOPLE[who] });
export const CAPS: Record<Who, Caps> = { boss: { readAll: true }, head: { readAll: false }, staff: { readAll: false }, other: { readAll: false }, outsider: { readAll: false }, gone: { readAll: false } };

class FakeClock extends Clock {
  current = new Date('2026-10-10T03:00:00Z'); // 10:00 giờ Việt Nam
  now() {
    return new Date(this.current);
  }
}

let seq = 0;
const nextId = (p: string) => `${p}${++seq}`;

class InMemoryMeetings extends MeetingRepository {
  rows: MeetingModel[] = [];
  async findById(id: string) {
    const r = this.rows.find((m) => m.id === id);
    return r ? { ...r } : null;
  }
  async findByIds(ids: readonly string[]) {
    return this.rows.filter((m) => ids.includes(m.id)).map((m) => ({ ...m }));
  }
  async findOverlapping(from: Date, to: Date) {
    return this.rows.filter((m) => m.startAt < to && m.endAt > from).map((m) => ({ ...m }));
  }
  async findByProject(projectId: string) {
    return this.rows.filter((m) => m.projectId === projectId).map((m) => ({ ...m }));
  }
  async findAll() {
    return this.rows.map((m) => ({ ...m }));
  }
  async create(data: NewMeeting) {
    const row: MeetingModel = { ...data, id: nextId('mt'), status: 'SCHEDULED', cancelReason: null, conclusion: null, concludedAt: null, createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: MeetingPatch) {
    const row = this.rows.find((m) => m.id === id)!;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return { ...row };
  }
}

class InMemoryRooms extends RoomRepository {
  rows: RoomModel[] = [
    { id: 'rm-1', name: 'Phòng họp số 1', capacity: 30, description: null, status: 'ACTIVE', createdAt: new Date(0) },
    { id: 'rm-2', name: 'Phòng họp số 2', capacity: 15, description: null, status: 'ACTIVE', createdAt: new Date(0) },
    { id: 'rm-old', name: 'Phòng họp cũ', capacity: null, description: null, status: 'INACTIVE', createdAt: new Date(0) },
  ];
  async findAll() {
    return this.rows.map((r) => ({ ...r }));
  }
  async findById(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async findByName(name: string) {
    const r = this.rows.find((x) => x.name.toLowerCase() === name.toLowerCase());
    return r ? { ...r } : null;
  }
  async create(data: NewRoom) {
    const row: RoomModel = { ...data, id: nextId('rm'), status: 'ACTIVE', createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: RoomPatch) {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return { ...row };
  }
}

class InMemoryAttendees extends AttendeeRepository {
  rows: AttendeeModel[] = [];
  async findByMeetings(ids: readonly string[]) {
    return this.rows.filter((a) => ids.includes(a.meetingId)).map((a) => ({ ...a }));
  }
  async meetingIdsOfPerson(personId: string) {
    return this.rows.filter((a) => a.personId === personId).map((a) => a.meetingId);
  }
  async upsert(meetingId: string, personId: string, role: AttendeeRole, response: Response) {
    const row = this.rows.find((a) => a.meetingId === meetingId && a.personId === personId);
    if (row) Object.assign(row, { role, response, respondedAt: response === 'PENDING' ? null : new Date(), note: null });
    else this.rows.push({ meetingId, personId, role, response, respondedAt: response === 'PENDING' ? null : new Date(), note: null, attended: null });
  }
  async remove(meetingId: string, personId: string) {
    this.rows = this.rows.filter((a) => !(a.meetingId === meetingId && a.personId === personId));
  }
  async respond(meetingId: string, personId: string, response: Response, note: string | null, at: Date) {
    Object.assign(this.rows.find((a) => a.meetingId === meetingId && a.personId === personId)!, { response, note, respondedAt: at });
  }
  async resetResponses(meetingId: string, keep: readonly string[]) {
    for (const a of this.rows) if (a.meetingId === meetingId && !keep.includes(a.personId)) Object.assign(a, { response: 'PENDING', respondedAt: null, note: null });
  }
  async setAttended(meetingId: string, attended: readonly string[]) {
    for (const a of this.rows) if (a.meetingId === meetingId) a.attended = attended.includes(a.personId);
  }
}

class InMemoryActions extends ActionRepository {
  rows: ActionModel[] = [];
  async findByMeetings(ids: readonly string[]) {
    return this.rows.filter((a) => ids.includes(a.meetingId)).map((a) => ({ ...a }));
  }
  async findById(id: string) {
    const a = this.rows.find((x) => x.id === id);
    return a ? { ...a } : null;
  }
  async findByAssignee(personId: string) {
    return this.rows.filter((a) => a.assigneePersonId === personId).map((a) => ({ ...a }));
  }
  async create(data: NewAction) {
    const row: ActionModel = { ...data, id: nextId('ac'), status: 'PENDING', completedOn: null, createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: ActionPatch) {
    const row = this.rows.find((a) => a.id === id)!;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    return { ...row };
  }
  async delete(id: string) {
    this.rows = this.rows.filter((a) => a.id !== id);
  }
}

class InMemoryAttachments extends MeetingAttachmentRepository {
  rows: MeetingAttachmentModel[] = [];
  async findByMeeting(meetingId: string) {
    return this.rows.filter((a) => a.meetingId === meetingId).map((a) => ({ ...a }));
  }
  async findById(id: string) {
    const a = this.rows.find((x) => x.id === id);
    return a ? { ...a } : null;
  }
  async create(data: NewMeetingAttachment) {
    const row: MeetingAttachmentModel = { ...data, id: nextId('at'), createdAt: new Date() };
    this.rows.push(row);
    return { ...row };
  }
}

class FakeOrg extends MeetingOrgDirectory {
  async activePersonIds(ids: readonly string[]) {
    return new Set(ids.filter((i) => Object.values(PEOPLE).includes(i as never) && i !== PEOPLE.gone));
  }
  async lookup() {
    return { persons: new Map(Object.entries(PEOPLE).map(([k, id]) => [id, { fullName: `Cán bộ ${k}` }])) };
  }
}

export class FakeProjects extends MeetingProjectDirectory {
  /** Đề án giả: mã → người xem được. */
  items = new Map<string, { code: string; title: string; viewers: string[] }>([['pr-1', { code: 'DA-2026-001', title: 'Đề án thử', viewers: ['acc-head', 'acc-staff', 'acc-boss'] }]]);
  async viewable(actor: Actor, projectId: string) {
    const p = this.items.get(projectId);
    if (!p || !p.viewers.includes(actor.id)) throw new Error('không xem được đề án');
    return { code: p.code, title: p.title };
  }
  async labels(ids: readonly string[]) {
    return new Map(ids.flatMap((id) => (this.items.has(id) ? [[id, { code: this.items.get(id)!.code, title: this.items.get(id)!.title }] as const] : [])));
  }
}

class FakeStorage extends FileStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    const d = this.files.get(key);
    if (!d) throw new Error('không có tệp');
    return d;
  }
}

export async function buildMeeting() {
  const clock = new FakeClock();
  const audit: { action: string; details?: Record<string, unknown> }[] = [];
  const repos = { meetings: new InMemoryMeetings(), rooms: new InMemoryRooms(), attendees: new InMemoryAttendees(), actions: new InMemoryActions(), attachments: new InMemoryAttachments() };
  const projects = new FakeProjects();
  const storage = new FakeStorage();
  const notifier = new FakeNotifier();
  const moduleRef = await Test.createTestingModule({
    providers: [
      MeetingService,
      { provide: Clock, useValue: clock },
      { provide: MeetingRepository, useValue: repos.meetings },
      { provide: RoomRepository, useValue: repos.rooms },
      { provide: AttendeeRepository, useValue: repos.attendees },
      { provide: ActionRepository, useValue: repos.actions },
      { provide: MeetingAttachmentRepository, useValue: repos.attachments },
      { provide: MeetingOrgDirectory, useValue: new FakeOrg() },
      { provide: MeetingProjectDirectory, useValue: projects },
      { provide: FileStorage, useValue: storage },
      { provide: AuditService, useValue: { record: async (e: { action: string; details?: Record<string, unknown> }) => void audit.push(e) } },
      { provide: Notifier, useValue: notifier },
    ],
  }).compile();
  return { service: moduleRef.get(MeetingService), clock, audit, repos, projects, storage, notifier };
}

export type Harness = Awaited<ReturnType<typeof buildMeeting>>;

/** Giờ Việt Nam sang chuỗi ISO có múi giờ, ví dụ vn('2026-10-12', '09:00'). */
export const vn = (date: string, time: string): string => `${date}T${time}:00+07:00`;

/** Họp 09:00 đến 10:30 ngày 12/10/2026 do `head` tạo, mời staff và other. */
export function seedMeeting(h: Harness, who: Who = 'head', over: Partial<MeetingInput> = {}) {
  return h.service.create(actorOf(who), CAPS[who], {
    title: 'Họp giao ban tuần',
    startAt: vn('2026-10-12', '09:00'),
    endAt: vn('2026-10-12', '10:30'),
    location: 'Phòng họp 1',
    attendees: [{ personId: PEOPLE.staff }, { personId: PEOPLE.other, role: 'OPTIONAL' }],
    ...over,
  });
}
