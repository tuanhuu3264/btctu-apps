import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Authenticated, CurrentAccount } from '../../security/index.js';
import type { CurrentAccountModel } from '../../security/index.js';
import type { NotificationPage } from '../application/notification.model.js';
import { NotificationService } from '../application/notification.service.js';
import { NotificationQueryDto } from './notification.dto.js';

/** Mọi người đã đăng nhập chỉ đọc và đánh dấu thông báo của chính mình (ADR-029 mục 2, 7). */
@Controller('notifications')
@Authenticated()
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentAccount() actor: CurrentAccountModel, @Query() query: NotificationQueryDto): Promise<NotificationPage> {
    return this.notifications.list(actor.personId, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentAccount() actor: CurrentAccountModel): Promise<{ unread: number }> {
    return { unread: await this.notifications.unreadCount(actor.personId) };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentAccount() actor: CurrentAccountModel): Promise<{ marked: number }> {
    return { marked: await this.notifications.markAllRead(actor.personId) };
  }

  @Post(':id/read')
  @HttpCode(204)
  markRead(@CurrentAccount() actor: CurrentAccountModel, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.markRead(actor.personId, id);
  }
}
