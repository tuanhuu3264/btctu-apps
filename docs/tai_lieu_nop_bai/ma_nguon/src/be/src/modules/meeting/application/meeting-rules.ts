import type { AttendeeModel, MeetingModel } from './meeting.model.js';

export interface Slot {
  startAt: Date;
  endAt: Date;
}

/** Hai khoảng thời gian chồng lên nhau (đầu mút chạm nhau không tính là trùng). */
export const overlaps = (a: Slot, b: Slot): boolean => a.startAt < b.endAt && b.startAt < a.endAt;

export interface Conflict {
  personId: string;
  meetingId: string;
  title: string;
  startAt: Date;
  endAt: Date;
}

/**
 * Cuộc họp khác của những người được mời mà trùng giờ với `slot`. Chỉ xét cuộc họp còn hiệu lực (SCHEDULED) và người chưa từ chối.
 * `excludeMeetingId` để bỏ chính cuộc họp đang sửa. Là cảnh báo, không chặn.
 */
export function findConflicts(slot: Slot, personIds: readonly string[], meetings: readonly MeetingModel[], attendees: readonly AttendeeModel[], excludeMeetingId?: string): Conflict[] {
  const wanted = new Set(personIds);
  const byMeeting = new Map(meetings.map((m) => [m.id, m]));
  const out: Conflict[] = [];
  for (const a of attendees) {
    if (!wanted.has(a.personId) || a.response === 'DECLINED' || a.meetingId === excludeMeetingId) continue;
    const m = byMeeting.get(a.meetingId);
    if (!m || m.status !== 'SCHEDULED' || !overlaps(slot, m)) continue;
    out.push({ personId: a.personId, meetingId: m.id, title: m.title, startAt: m.startAt, endAt: m.endAt });
  }
  return out.sort((x, y) => x.startAt.getTime() - y.startAt.getTime() || x.personId.localeCompare(y.personId));
}
