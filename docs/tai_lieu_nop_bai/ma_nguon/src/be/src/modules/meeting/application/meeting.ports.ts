import type {
  ActionModel,
  ActionPatch,
  AttendeeModel,
  AttendeeRole,
  MeetingAttachmentModel,
  MeetingModel,
  MeetingPatch,
  NewAction,
  NewMeeting,
  NewMeetingAttachment,
  NewRoom,
  Response,
  RoomModel,
  RoomPatch,
} from './meeting.model.js';

/** Các cổng của lớp nghiệp vụ (abstract class để làm token DI). */
export abstract class MeetingRepository {
  abstract findById(id: string): Promise<MeetingModel | null>;
  abstract findByIds(ids: readonly string[]): Promise<MeetingModel[]>;
  /** Cuộc họp có khoảng thời gian chồng lên [from, to), mọi trạng thái. */
  abstract findOverlapping(from: Date, to: Date): Promise<MeetingModel[]>;
  abstract findByProject(projectId: string): Promise<MeetingModel[]>;
  abstract findAll(): Promise<MeetingModel[]>;
  abstract create(data: NewMeeting): Promise<MeetingModel>;
  abstract update(id: string, patch: MeetingPatch): Promise<MeetingModel>;
}

export abstract class RoomRepository {
  abstract findAll(): Promise<RoomModel[]>;
  abstract findById(id: string): Promise<RoomModel | null>;
  abstract findByName(name: string): Promise<RoomModel | null>;
  abstract create(data: NewRoom): Promise<RoomModel>;
  abstract update(id: string, patch: RoomPatch): Promise<RoomModel>;
}

export abstract class AttendeeRepository {
  abstract findByMeetings(meetingIds: readonly string[]): Promise<AttendeeModel[]>;
  /** Mã cuộc họp mà cán bộ được mời (kể cả chủ trì). */
  abstract meetingIdsOfPerson(personId: string): Promise<string[]>;
  /** Thêm người dự; đã có thì đặt lại vai trò và trả lời. */
  abstract upsert(meetingId: string, personId: string, role: AttendeeRole, response: Response): Promise<void>;
  abstract remove(meetingId: string, personId: string): Promise<void>;
  abstract respond(meetingId: string, personId: string, response: Response, note: string | null, at: Date): Promise<void>;
  /** Đặt lại trả lời về chờ cho mọi người dự trừ những mã được giữ (khi đổi giờ). */
  abstract resetResponses(meetingId: string, keepPersonIds: readonly string[]): Promise<void>;
  abstract setAttended(meetingId: string, attendedPersonIds: readonly string[]): Promise<void>;
}

export abstract class ActionRepository {
  abstract findByMeetings(meetingIds: readonly string[]): Promise<ActionModel[]>;
  abstract findById(id: string): Promise<ActionModel | null>;
  abstract findByAssignee(personId: string): Promise<ActionModel[]>;
  abstract create(data: NewAction): Promise<ActionModel>;
  abstract update(id: string, patch: ActionPatch): Promise<ActionModel>;
  abstract delete(id: string): Promise<void>;
}

export abstract class MeetingAttachmentRepository {
  abstract findByMeeting(meetingId: string): Promise<MeetingAttachmentModel[]>;
  abstract findById(id: string): Promise<MeetingAttachmentModel | null>;
  abstract create(data: NewMeetingAttachment): Promise<MeetingAttachmentModel>;
}

/** Cổng sang mô-đun organization. */
export abstract class MeetingOrgDirectory {
  /** Trong các mã đã cho, những cán bộ còn được quản lý (chưa ngừng). */
  abstract activePersonIds(personIds: readonly string[]): Promise<Set<string>>;
  abstract lookup(): Promise<{ persons: Map<string, { fullName: string }> }>;
}

/** Cổng sang mô-đun project: kiểm tra người gọi xem được đề án và lấy mã, tên để hiện. */
export abstract class MeetingProjectDirectory {
  /** Ném lỗi nếu đề án không có hoặc người gọi không xem được. */
  abstract viewable(actor: { id: string; username: string; personId: string | null }, projectId: string): Promise<{ code: string; title: string }>;
  abstract labels(projectIds: readonly string[]): Promise<Map<string, { code: string; title: string }>>;
}
