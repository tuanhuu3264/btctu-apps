import type { NewNotification, NotificationModel } from './notification.model.js';

export abstract class NotificationRepository {
  abstract insertMany(rows: NewNotification[]): Promise<void>;
  /** Mới nhất trước. */
  abstract list(personId: string, unreadOnly: boolean, limit: number, offset: number): Promise<{ items: NotificationModel[]; total: number }>;
  abstract countUnread(personId: string): Promise<number>;
  /** Đánh dấu đã đọc thông báo của chính người đó; trả về false nếu không có thông báo như vậy. */
  abstract markRead(personId: string, id: string, at: Date): Promise<boolean>;
  abstract markAllRead(personId: string, at: Date): Promise<number>;
  /** Xóa các thông báo đã đọc trước thời điểm `before`; trả về số bản ghi đã xóa. */
  abstract deleteReadBefore(before: Date): Promise<number>;
}
