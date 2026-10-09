import { Notifier } from '../notifier.js';
import type { NotificationContent } from '../notifier.js';

export interface SentNotification extends NotificationContent {
  /** Người nhận cụ thể, hoặc `permission:<quyền>` khi gửi theo quyền. */
  to: string[];
  except?: string | null;
}

/** Notifier giả cho test: ghi lại mọi thông báo đã gửi, bỏ người nhận trống và trùng như bản thật. */
export class FakeNotifier extends Notifier {
  sent: SentNotification[] = [];

  async notify(personIds: readonly (string | null | undefined)[], content: NotificationContent): Promise<void> {
    const to = [...new Set(personIds.filter((p): p is string => typeof p === 'string' && p !== ''))];
    if (to.length > 0) this.sent.push({ ...content, to });
  }

  async notifyPermitted(permission: string, exceptPersonId: string | null | undefined, content: NotificationContent): Promise<void> {
    this.sent.push({ ...content, to: [`permission:${permission}`], except: exceptPersonId });
  }

  /** Thông báo đã gửi theo loại. */
  of(type: NotificationContent['type']): SentNotification[] {
    return this.sent.filter((s) => s.type === type);
  }
}
