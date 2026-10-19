import { NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { RecipientService } from '../../security/index.js';
import type { NewNotification, NotificationModel } from './notification.model.js';
import { NotificationRepository } from './notification.ports.js';
import { NotificationService, RETENTION_DAYS } from './notification.service.js';

class MemRepo extends NotificationRepository {
  rows: NotificationModel[] = [];
  failInsert = false;
  private seq = 0;
  async insertMany(rows: NewNotification[]) {
    if (this.failInsert) throw new Error('db lỗi');
    for (const r of rows) this.rows.push({ ...r, id: `n-${++this.seq}`, createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, this.seq)), readAt: null });
  }
  async list(personId: string, unreadOnly: boolean, limit: number, offset: number) {
    const all = this.rows.filter((r) => r.recipientPersonId === personId && (!unreadOnly || !r.readAt)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
  async countUnread(personId: string) {
    return this.rows.filter((r) => r.recipientPersonId === personId && !r.readAt).length;
  }
  async markRead(personId: string, id: string, at: Date) {
    const r = this.rows.find((x) => x.id === id && x.recipientPersonId === personId);
    if (!r) return false;
    r.readAt ??= at;
    return true;
  }
  async markAllRead(personId: string, at: Date) {
    const mine = this.rows.filter((r) => r.recipientPersonId === personId && !r.readAt);
    for (const r of mine) r.readAt = at;
    return mine.length;
  }
  async deleteReadBefore(before: Date) {
    const keep = this.rows.filter((r) => !(r.readAt && r.createdAt < before));
    const n = this.rows.length - keep.length;
    this.rows = keep;
    return n;
  }
}

const NOW = new Date('2026-10-08T03:00:00Z');

function build() {
  const repo = new MemRepo();
  const recipients = { personIdsWithPermission: async (p: string) => (p === 'document:read' ? ['p-a', 'p-b', 'p-c'] : []) } as unknown as RecipientService;
  const clock = { now: () => NOW } as Clock;
  return { repo, service: new NotificationService(repo, recipients, clock) };
}

describe('NotificationService', () => {
  it('gửi: bỏ người nhận trống và trùng; đường dẫn chỉ nhận đường dẫn nội bộ; tiêu đề bị cắt gọn', async () => {
    const { repo, service } = build();
    await service.notify(['p-a', 'p-a', null, undefined, ''], { type: 'TASK_ASSIGNED', title: 'x'.repeat(300), link: '/tasks?open=1' });
    await service.notify(['p-b'], { type: 'TASK_ASSIGNED', title: 'Ngoài', link: 'https://nguy-hiem.example/' });
    expect(repo.rows).toHaveLength(2);
    expect(repo.rows[0]).toMatchObject({ recipientPersonId: 'p-a', link: '/tasks?open=1' });
    expect(repo.rows[0].title).toHaveLength(200);
    expect(repo.rows[1].link).toBeNull();
    await service.notify([], { type: 'TASK_ASSIGNED', title: 'Không ai' });
    expect(repo.rows).toHaveLength(2);
  });

  it('lỗi khi lưu không làm hỏng nghiệp vụ gọi gửi', async () => {
    const { repo, service } = build();
    repo.failInsert = true;
    await expect(service.notify(['p-a'], { type: 'DOC_PUBLISHED', title: 'x' })).resolves.toBeUndefined();
    await expect(service.notifyPermitted('document:read', null, { type: 'DOC_PUBLISHED', title: 'x' })).resolves.toBeUndefined();
  });

  it('gửi theo quyền: mọi người có quyền trừ người loại trừ', async () => {
    const { repo, service } = build();
    await service.notifyPermitted('document:read', 'p-b', { type: 'DOC_PUBLISHED', title: 'Tài liệu mới' });
    expect(repo.rows.map((r) => r.recipientPersonId)).toEqual(['p-a', 'p-c']);
    await service.notifyPermitted('quyen-khac', null, { type: 'DOC_PUBLISHED', title: 'Không ai' });
    expect(repo.rows).toHaveLength(2);
  });

  it('đọc: chỉ thấy thông báo của mình, mới nhất trước, lọc chưa đọc, phân trang, đếm chưa đọc', async () => {
    const { service } = build();
    for (const t of ['một', 'hai', 'ba']) await service.notify(['p-a'], { type: 'TASK_COMMENT', title: t });
    await service.notify(['p-b'], { type: 'TASK_COMMENT', title: 'của người khác' });

    const page = await service.list('p-a', { pageSize: 2 });
    expect(page.items.map((i) => i.title)).toEqual(['ba', 'hai']);
    expect(page).toMatchObject({ total: 3, unread: 3, page: 1, pageSize: 2 });

    await service.markRead('p-a', page.items[0].id);
    expect((await service.list('p-a', { unread: true })).items.map((i) => i.title)).toEqual(['hai', 'một']);
    expect(await service.unreadCount('p-a')).toBe(2);
    expect(await service.markAllRead('p-a')).toBe(2);
    expect(await service.unreadCount('p-a')).toBe(0);
    expect(await service.unreadCount('p-b')).toBe(1);
  });

  it('không đánh dấu hay dò được thông báo của người khác; người chưa gắn cán bộ không có thông báo', async () => {
    const { service } = build();
    await service.notify(['p-a'], { type: 'TASK_COMMENT', title: 'riêng tư' });
    const id = (await service.list('p-a', {})).items[0].id;
    await expect(service.markRead('p-b', id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markRead(null, id)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.list(null, {})).toMatchObject({ items: [], total: 0, unread: 0 });
    expect(await service.markAllRead(null)).toBe(0);
    await expect(service.list('p-a', { page: 0 })).rejects.toThrow('Trang');
    await expect(service.list('p-a', { pageSize: 101 })).rejects.toThrow('Cỡ trang');
  });

  it('dọn: chỉ xóa thông báo đã đọc quá hạn, giữ thông báo chưa đọc dù cũ', async () => {
    const { repo, service } = build();
    await service.notify(['p-a'], { type: 'TASK_COMMENT', title: 'cũ đã đọc' });
    await service.notify(['p-a'], { type: 'TASK_COMMENT', title: 'cũ chưa đọc' });
    await service.notify(['p-a'], { type: 'TASK_COMMENT', title: 'mới đã đọc' });
    const old = new Date(NOW.getTime() - (RETENTION_DAYS + 1) * 24 * 3600 * 1000);
    repo.rows[0].createdAt = old;
    repo.rows[0].readAt = old;
    repo.rows[1].createdAt = old;
    repo.rows[2].readAt = NOW;
    expect(await service.purge()).toBe(1);
    expect(repo.rows.map((r) => r.title)).toEqual(['cũ chưa đọc', 'mới đã đọc']);
  });
});
