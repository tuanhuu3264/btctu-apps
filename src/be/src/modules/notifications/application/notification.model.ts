import type { NotificationType } from '../../../common/notifier.js';

export interface NotificationModel {
  id: string;
  recipientPersonId: string;
  type: NotificationType;
  title: string;
  link: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export type NewNotification = Pick<NotificationModel, 'recipientPersonId' | 'type' | 'title' | 'link'>;

export interface NotificationPage {
  items: NotificationModel[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}
