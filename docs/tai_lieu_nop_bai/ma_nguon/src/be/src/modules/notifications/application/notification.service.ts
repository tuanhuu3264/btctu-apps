import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import type { NotificationContent } from '../../../common/notifier.js';
import { RecipientService } from '../../security/index.js';
import type { Permission } from '../../security/index.js';
import type { NotificationPage } from './notification.model.js';
import { NotificationRepository } from './notification.ports.js';

export const RETENTION_DAYS = 90;
const MAX_TITLE = 200;
const MAX_LINK = 200;

/**
 * Thông báo trong hệ thống (ADR-029). Vừa là cổng `Notifier` cho các mô-đun khác (gửi không bao giờ ném lỗi)
 * vừa là phía đọc của người dùng (chỉ đọc, đánh dấu thông báo của chính mình).
 */
@Injectable()
export class NotificationService extends Notifier {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly recipients: RecipientService,
    private readonly clock: Clock,
  ) {
    super();
  }

  async notify(personIds: readonly (string | null | undefined)[], content: NotificationContent): Promise<void> {
    try {
      const unique = [...new Set(personIds.filter((p): p is string => typeof p === 'string' && p !== ''))];
      if (unique.length === 0) return;
      const title = content.title.slice(0, MAX_TITLE);
      const link = content.link && content.link.startsWith('/') ? content.link.slice(0, MAX_LINK) : null;
      await this.repo.insertMany(unique.map((recipientPersonId) => ({ recipientPersonId, type: content.type, title, link })));
    } catch (e) {
      this.logger.error(`Không gửi được thông báo ${content.type}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async notifyPermitted(permission: string, exceptPersonId: string | null | undefined, content: NotificationContent): Promise<void> {
    try {
      const ids = (await this.recipients.personIdsWithPermission(permission as Permission)).filter((p) => p !== exceptPersonId);
      await this.notify(ids, content);
    } catch (e) {
      this.logger.error(`Không gửi được thông báo ${content.type}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async list(personId: string | null, query: { unread?: boolean; page?: number; pageSize?: number }): Promise<NotificationPage> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!Number.isInteger(page) || page < 1) throw new BadRequestException('Trang phải là số nguyên từ 1');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('Cỡ trang từ 1 đến 100');
    if (!personId) return { items: [], total: 0, unread: 0, page, pageSize };
    const { items, total } = await this.repo.list(personId, query.unread === true, pageSize, (page - 1) * pageSize);
    return { items, total, unread: await this.repo.countUnread(personId), page, pageSize };
  }

  async unreadCount(personId: string | null): Promise<number> {
    return personId ? this.repo.countUnread(personId) : 0;
  }

  async markRead(personId: string | null, id: string): Promise<void> {
    // Thông báo của người khác trả về như không tồn tại, không cho dò mã.
    if (!personId || !(await this.repo.markRead(personId, id, this.clock.now()))) throw new NotFoundException('Không tìm thấy thông báo');
  }

  async markAllRead(personId: string | null): Promise<number> {
    return personId ? this.repo.markAllRead(personId, this.clock.now()) : 0;
  }

  /** Xóa thông báo đã đọc quá thời hạn lưu (ADR-029 mục 8). */
  async purge(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - RETENTION_DAYS * 24 * 3600 * 1000);
    return this.repo.deleteReadBefore(before);
  }
}
