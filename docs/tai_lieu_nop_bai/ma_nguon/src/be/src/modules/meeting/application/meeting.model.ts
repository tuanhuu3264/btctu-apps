/**
 * Lịch họp (ADR-051): tạo cuộc họp, mời thành phần, người được mời xác nhận, cảnh báo trùng lịch, ghi kết luận và việc sau họp.
 * Không đổi điểm KPI: việc sau họp là danh sách theo dõi riêng của cuộc họp.
 */
export const MEETING_STATUSES = ['SCHEDULED', 'HELD', 'CANCELLED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const ATTENDEE_ROLES = ['ORGANIZER', 'REQUIRED', 'OPTIONAL'] as const;
export type AttendeeRole = (typeof ATTENDEE_ROLES)[number];

export const RESPONSES = ['PENDING', 'ACCEPTED', 'DECLINED'] as const;
export type Response = (typeof RESPONSES)[number];

export const ACTION_STATUSES = ['PENDING', 'DONE'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const ROOM_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

/** Phòng họp trong danh mục dùng chung (dữ liệu tham chiếu do Văn phòng quản lý). */
export interface RoomModel {
  id: string;
  name: string;
  /** Sức chứa (số chỗ); null nếu chưa ghi. */
  capacity: number | null;
  description: string | null;
  status: RoomStatus;
  createdAt: Date;
}
export type NewRoom = Pick<RoomModel, 'name' | 'capacity' | 'description'>;
export type RoomPatch = Partial<Pick<RoomModel, 'name' | 'capacity' | 'description' | 'status'>>;

export const MAX_ATTENDEES = 200;
export const MAX_ACTIONS = 50;
export const MAX_ATTACHMENTS = 20;
/** Một cuộc họp tối đa 12 giờ. */
export const MAX_DURATION_MS = 12 * 3_600_000;

export interface MeetingModel {
  id: string;
  title: string;
  /** Nội dung, chương trình họp. */
  agenda: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  /** Đường dẫn họp trực tuyến (https). */
  onlineLink: string | null;
  /** Phòng họp chọn từ danh mục; null nếu địa điểm là chữ tự do. */
  roomId: string | null;
  /** Chủ trì cuộc họp. */
  organizerPersonId: string;
  createdByAccountId: string;
  /** Đề án, dự án liên quan (tùy chọn). */
  projectId: string | null;
  status: MeetingStatus;
  cancelReason: string | null;
  /** Kết luận cuộc họp. */
  conclusion: string | null;
  concludedAt: Date | null;
  createdAt: Date;
}
export type NewMeeting = Pick<MeetingModel, 'title' | 'agenda' | 'startAt' | 'endAt' | 'location' | 'onlineLink' | 'roomId' | 'organizerPersonId' | 'createdByAccountId' | 'projectId'>;
export type MeetingPatch = Partial<Pick<MeetingModel, 'title' | 'agenda' | 'startAt' | 'endAt' | 'location' | 'onlineLink' | 'roomId' | 'organizerPersonId' | 'projectId' | 'status' | 'cancelReason' | 'conclusion' | 'concludedAt'>>;

export interface AttendeeModel {
  meetingId: string;
  personId: string;
  role: AttendeeRole;
  response: Response;
  respondedAt: Date | null;
  /** Lý do từ chối hoặc ghi chú khi trả lời. */
  note: string | null;
  /** Có mặt thực tế; null khi chưa ghi nhận (cuộc họp chưa kết thúc). */
  attended: boolean | null;
}

export interface ActionModel {
  id: string;
  meetingId: string;
  content: string;
  assigneePersonId: string;
  dueDate: string;
  status: ActionStatus;
  completedOn: string | null;
  createdAt: Date;
}
export type NewAction = Pick<ActionModel, 'meetingId' | 'content' | 'assigneePersonId' | 'dueDate'>;
export type ActionPatch = Partial<Pick<ActionModel, 'content' | 'assigneePersonId' | 'dueDate' | 'status' | 'completedOn'>>;

export interface MeetingAttachmentModel {
  id: string;
  meetingId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageKey: string;
  uploadedByAccountId: string;
  createdAt: Date;
}
export type NewMeetingAttachment = Omit<MeetingAttachmentModel, 'id' | 'createdAt'>;
