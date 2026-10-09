import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import type { NewNotification, NotificationModel } from '../application/notification.model.js';
import { NotificationRepository } from '../application/notification.ports.js';
import { NotificationEntity } from './notification.entity.js';

@Injectable()
export class TypeOrmNotificationRepository extends NotificationRepository {
  constructor(@InjectRepository(NotificationEntity) private readonly repo: Repository<NotificationEntity>) {
    super();
  }

  async insertMany(rows: NewNotification[]): Promise<void> {
    await this.repo.insert(rows);
  }

  async list(personId: string, unreadOnly: boolean, limit: number, offset: number): Promise<{ items: NotificationModel[]; total: number }> {
    const [items, total] = await this.repo.findAndCount({
      where: { recipientPersonId: personId, ...(unreadOnly ? { readAt: IsNull() } : {}) },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }

  countUnread(personId: string): Promise<number> {
    return this.repo.count({ where: { recipientPersonId: personId, readAt: IsNull() } });
  }

  async markRead(personId: string, id: string, at: Date): Promise<boolean> {
    const existing = await this.repo.findOne({ where: { id, recipientPersonId: personId } });
    if (!existing) return false;
    if (!existing.readAt) await this.repo.update({ id }, { readAt: at });
    return true;
  }

  async markAllRead(personId: string, at: Date): Promise<number> {
    const r = await this.repo.update({ recipientPersonId: personId, readAt: IsNull() }, { readAt: at });
    return r.affected ?? 0;
  }

  async deleteReadBefore(before: Date): Promise<number> {
    const r = await this.repo.delete({ readAt: Not(IsNull()), createdAt: LessThan(before) });
    return r.affected ?? 0;
  }
}
