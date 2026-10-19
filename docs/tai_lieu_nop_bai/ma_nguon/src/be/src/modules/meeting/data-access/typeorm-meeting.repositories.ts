import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, MoreThan, Repository } from 'typeorm';
import { ILike } from 'typeorm';
import type { ActionModel, ActionPatch, AttendeeModel, AttendeeRole, MeetingAttachmentModel, MeetingModel, MeetingPatch, NewAction, NewMeeting, NewMeetingAttachment, NewRoom, Response, RoomModel, RoomPatch } from '../application/meeting.model.js';
import { ActionRepository, AttendeeRepository, MeetingAttachmentRepository, MeetingRepository, RoomRepository } from '../application/meeting.ports.js';
import { MeetingActionEntity, MeetingAttachmentEntity, MeetingAttendeeEntity, MeetingEntity, MeetingRoomEntity } from './meeting.entities.js';

const defined = <T extends object>(patch: T): Partial<T> => Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

const toMeeting = (e: MeetingEntity): MeetingModel => ({
  id: e.id,
  title: e.title,
  agenda: e.agenda,
  startAt: e.startAt,
  endAt: e.endAt,
  location: e.location,
  onlineLink: e.onlineLink,
  roomId: e.roomId,
  organizerPersonId: e.organizerPersonId,
  createdByAccountId: e.createdByAccountId,
  projectId: e.projectId,
  status: e.status,
  cancelReason: e.cancelReason,
  conclusion: e.conclusion,
  concludedAt: e.concludedAt,
  createdAt: e.createdAt,
});

const toAttendee = (e: MeetingAttendeeEntity): AttendeeModel => ({
  meetingId: e.meetingId,
  personId: e.personId,
  role: e.role,
  response: e.response,
  respondedAt: e.respondedAt,
  note: e.note,
  attended: e.attended,
});

const toAction = (e: MeetingActionEntity): ActionModel => ({
  id: e.id,
  meetingId: e.meetingId,
  content: e.content,
  assigneePersonId: e.assigneePersonId,
  dueDate: e.dueDate,
  status: e.status,
  completedOn: e.completedOn,
  createdAt: e.createdAt,
});

const toAttachment = (e: MeetingAttachmentEntity): MeetingAttachmentModel => ({
  id: e.id,
  meetingId: e.meetingId,
  fileName: e.fileName,
  contentType: e.contentType,
  sizeBytes: e.sizeBytes,
  storageKey: e.storageKey,
  uploadedByAccountId: e.uploadedByAccountId,
  createdAt: e.createdAt,
});

@Injectable()
export class TypeOrmMeetingRepository extends MeetingRepository {
  constructor(@InjectRepository(MeetingEntity) private readonly repo: Repository<MeetingEntity>) {
    super();
  }

  async findById(id: string): Promise<MeetingModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toMeeting(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<MeetingModel[]> {
    if (ids.length === 0) return [];
    return (await this.repo.find({ where: { id: In([...ids]) } })).map(toMeeting);
  }

  async findOverlapping(from: Date, to: Date): Promise<MeetingModel[]> {
    return (await this.repo.find({ where: { startAt: LessThan(to), endAt: MoreThan(from) }, order: { startAt: 'ASC' } })).map(toMeeting);
  }

  async findByProject(projectId: string): Promise<MeetingModel[]> {
    return (await this.repo.find({ where: { projectId }, order: { startAt: 'ASC' } })).map(toMeeting);
  }

  async findAll(): Promise<MeetingModel[]> {
    return (await this.repo.find({ order: { startAt: 'ASC' } })).map(toMeeting);
  }

  async create(data: NewMeeting): Promise<MeetingModel> {
    return toMeeting(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: MeetingPatch): Promise<MeetingModel> {
    const clean = defined(patch);
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    return toMeeting(await this.repo.findOneByOrFail({ id }));
  }
}

@Injectable()
export class TypeOrmAttendeeRepository extends AttendeeRepository {
  constructor(@InjectRepository(MeetingAttendeeEntity) private readonly repo: Repository<MeetingAttendeeEntity>) {
    super();
  }

  async findByMeetings(meetingIds: readonly string[]): Promise<AttendeeModel[]> {
    if (meetingIds.length === 0) return [];
    return (await this.repo.find({ where: { meetingId: In([...meetingIds]) } })).map(toAttendee);
  }

  async meetingIdsOfPerson(personId: string): Promise<string[]> {
    return (await this.repo.find({ where: { personId }, select: { meetingId: true } })).map((a) => a.meetingId);
  }

  async upsert(meetingId: string, personId: string, role: AttendeeRole, response: Response): Promise<void> {
    await this.repo.upsert({ meetingId, personId, role, response, respondedAt: response === 'PENDING' ? null : new Date(), note: null }, ['meetingId', 'personId']);
  }

  async remove(meetingId: string, personId: string): Promise<void> {
    await this.repo.delete({ meetingId, personId });
  }

  async respond(meetingId: string, personId: string, response: Response, note: string | null, at: Date): Promise<void> {
    await this.repo.update({ meetingId, personId }, { response, note, respondedAt: at });
  }

  async resetResponses(meetingId: string, keepPersonIds: readonly string[]): Promise<void> {
    const rows = await this.repo.find({ where: { meetingId } });
    const keep = new Set(keepPersonIds);
    for (const r of rows) if (!keep.has(r.personId)) await this.repo.update({ meetingId, personId: r.personId }, { response: 'PENDING', respondedAt: null, note: null });
  }

  async setAttended(meetingId: string, attendedPersonIds: readonly string[]): Promise<void> {
    const attended = new Set(attendedPersonIds);
    for (const r of await this.repo.find({ where: { meetingId } })) await this.repo.update({ meetingId, personId: r.personId }, { attended: attended.has(r.personId) });
  }
}

@Injectable()
export class TypeOrmActionRepository extends ActionRepository {
  constructor(@InjectRepository(MeetingActionEntity) private readonly repo: Repository<MeetingActionEntity>) {
    super();
  }

  async findByMeetings(meetingIds: readonly string[]): Promise<ActionModel[]> {
    if (meetingIds.length === 0) return [];
    return (await this.repo.find({ where: { meetingId: In([...meetingIds]) }, order: { dueDate: 'ASC', createdAt: 'ASC' } })).map(toAction);
  }

  async findById(id: string): Promise<ActionModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toAction(row) : null;
  }

  async findByAssignee(personId: string): Promise<ActionModel[]> {
    return (await this.repo.find({ where: { assigneePersonId: personId }, order: { dueDate: 'ASC' } })).map(toAction);
  }

  async create(data: NewAction): Promise<ActionModel> {
    return toAction(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: ActionPatch): Promise<ActionModel> {
    const clean = defined(patch);
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    return toAction(await this.repo.findOneByOrFail({ id }));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }
}

@Injectable()
export class TypeOrmMeetingAttachmentRepository extends MeetingAttachmentRepository {
  constructor(@InjectRepository(MeetingAttachmentEntity) private readonly repo: Repository<MeetingAttachmentEntity>) {
    super();
  }

  async findByMeeting(meetingId: string): Promise<MeetingAttachmentModel[]> {
    return (await this.repo.find({ where: { meetingId }, order: { createdAt: 'ASC' } })).map(toAttachment);
  }

  async findById(id: string): Promise<MeetingAttachmentModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? toAttachment(row) : null;
  }

  async create(data: NewMeetingAttachment): Promise<MeetingAttachmentModel> {
    return toAttachment(await this.repo.save(this.repo.create(data)));
  }
}

@Injectable()
export class TypeOrmRoomRepository extends RoomRepository {
  constructor(@InjectRepository(MeetingRoomEntity) private readonly repo: Repository<MeetingRoomEntity>) {
    super();
  }

  private static toModel(e: MeetingRoomEntity): RoomModel {
    return { id: e.id, name: e.name, capacity: e.capacity, description: e.description, status: e.status, createdAt: e.createdAt };
  }

  async findAll(): Promise<RoomModel[]> {
    return (await this.repo.find({ order: { name: 'ASC' } })).map(TypeOrmRoomRepository.toModel);
  }

  async findById(id: string): Promise<RoomModel | null> {
    const row = await this.repo.findOneBy({ id });
    return row ? TypeOrmRoomRepository.toModel(row) : null;
  }

  /** Không phân biệt hoa thường. */
  async findByName(name: string): Promise<RoomModel | null> {
    const row = await this.repo.findOne({ where: { name: ILike(name.replace(/[%_\\]/g, '\\$&')) } });
    return row ? TypeOrmRoomRepository.toModel(row) : null;
  }

  async create(data: NewRoom): Promise<RoomModel> {
    return TypeOrmRoomRepository.toModel(await this.repo.save(this.repo.create(data)));
  }

  async update(id: string, patch: RoomPatch): Promise<RoomModel> {
    const clean = defined(patch);
    if (Object.keys(clean).length > 0) await this.repo.update({ id }, clean);
    return TypeOrmRoomRepository.toModel(await this.repo.findOneByOrFail({ id }));
  }
}
