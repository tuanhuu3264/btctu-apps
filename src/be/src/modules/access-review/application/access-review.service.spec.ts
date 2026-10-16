import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import type { NotificationContent } from '../../../common/notifier.js';
import { AuditService } from '../../security/index.js';
import type { AccessReviewItemModel, AccessReviewModel, ItemDecisionPatch, NewAccessReview, NewAccessReviewItem } from './access-review.model.js';
import { AccessReviewRepository, ReviewExporter, ReviewOrgDirectory, RoleSource } from './access-review.ports.js';
import type { LiveRole, PersonPlacement } from './access-review.ports.js';
import { AccessReviewService } from './access-review.service.js';
import type { ReviewAccess, ReviewActor } from './access-review.service.js';

class FakeClock extends Clock {
  current = new Date('2026-10-05T03:00:00Z'); // 10:00 giờ Việt Nam, quý IV/2026
  now() {
    return new Date(this.current);
  }
}

class InMemoryReviews extends AccessReviewRepository {
  reviews: AccessReviewModel[] = [];
  rows: AccessReviewItemModel[] = [];
  private seq = 0;
  async create(review: NewAccessReview, items: readonly NewAccessReviewItem[]) {
    const r: AccessReviewModel = { ...review, id: `r${++this.seq}`, status: 'OPEN', closedBy: null, closedAt: null };
    this.reviews.push(r);
    for (const i of items) {
      this.rows.push({ ...i, id: `i${++this.seq}`, reviewId: r.id, decision: null, decidedBy: null, decidedAt: null, note: null, revokeApplied: false });
    }
    return r;
  }
  async findById(id: string) {
    return this.reviews.find((r) => r.id === id) ?? null;
  }
  async findByQuarter(year: number, quarter: number) {
    return this.reviews.find((r) => r.year === year && r.quarter === quarter) ?? null;
  }
  async findAll() {
    return [...this.reviews].reverse();
  }
  async items(reviewId: string) {
    return this.rows.filter((i) => i.reviewId === reviewId);
  }
  async findItem(itemId: string) {
    return this.rows.find((i) => i.id === itemId) ?? null;
  }
  async decideItem(itemId: string, patch: ItemDecisionPatch) {
    const row = this.rows.find((i) => i.id === itemId)!;
    Object.assign(row, patch);
    return row;
  }
  async close(id: string, closedBy: string, at: Date) {
    const r = this.reviews.find((x) => x.id === id)!;
    Object.assign(r, { status: 'CLOSED', closedBy, closedAt: at });
    return r;
  }
}

class FakeRoles extends RoleSource {
  live: LiveRole[] = [];
  revoked: string[] = [];
  async liveRoles() {
    return this.live.filter((r) => !this.revoked.includes(r.roleAssignmentId));
  }
  async revoke(_accountId: string, roleAssignmentId: string) {
    this.revoked.push(roleAssignmentId);
  }
}

class FakeOrg extends ReviewOrgDirectory {
  map = new Map<string, PersonPlacement>();
  async placements(personIds: readonly string[]) {
    return new Map(personIds.flatMap((id) => (this.map.has(id) ? [[id, this.map.get(id)!] as const] : [])));
  }
}

class FakeExporter extends ReviewExporter {
  async renderExcel() {
    return Buffer.from('xlsx');
  }
}

// Cán bộ và tài khoản: một lãnh đạo phòng (P1), hai chuyên viên cùng phòng (P2, P3), Trưởng ban không có cấp trên (P0), một quản trị không gắn cán bộ.
const ACC = { leader: 'acc-leader', staff: 'acc-staff', staff2: 'acc-staff2', head: 'acc-head', admin: 'acc-admin', dataAdmin: 'acc-data' };
const PERSON = { head: 'p0', leader: 'p1', staff: 'p2', staff2: 'p3' };
const role = (id: string, accountId: string, username: string, personId: string | null, name: string): LiveRole => ({
  accountId,
  username,
  personId,
  role: name,
  roleAssignmentId: id,
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: null,
});

const actorOf = (id: string, username: string, personId: string | null): ReviewActor => ({ id, username, personId });
const ADMIN: ReviewActor = actorOf(ACC.admin, 'quantri', null);
const LEADER: ReviewActor = actorOf(ACC.leader, 'truongphong', PERSON.leader);
const HEAD: ReviewActor = actorOf(ACC.head, 'truongban', PERSON.head);
const DATA_ADMIN: ReviewActor = actorOf(ACC.dataAdmin, 'quantridulieu', null);
const MANAGE: ReviewAccess = { manage: true, oversee: false, confirm: false };
const CONFIRM: ReviewAccess = { manage: false, oversee: false, confirm: true };
const OVERSEE: ReviewAccess = { manage: false, oversee: true, confirm: false };

describe('AccessReviewService', () => {
  let service: AccessReviewService;
  let repo: InMemoryReviews;
  let roles: FakeRoles;
  let org: FakeOrg;
  let clock: FakeClock;
  const sent: { personIds: (string | null | undefined)[]; content: NotificationContent }[] = [];
  const permitted: { permission: string; content: NotificationContent }[] = [];
  const audit: { action: string; details?: Record<string, unknown> }[] = [];

  beforeEach(async () => {
    sent.length = 0;
    permitted.length = 0;
    audit.length = 0;
    repo = new InMemoryReviews();
    roles = new FakeRoles();
    org = new FakeOrg();
    clock = new FakeClock();
    roles.live = [
      role('ra1', ACC.leader, 'truongphong', PERSON.leader, 'TRUONG_PHO_PHONG'),
      role('ra2', ACC.staff, 'chuyenvien1', PERSON.staff, 'CHUYEN_VIEN'),
      role('ra3', ACC.staff2, 'chuyenvien2', PERSON.staff2, 'CHUYEN_VIEN'),
      role('ra4', ACC.head, 'truongban', PERSON.head, 'TRUONG_BAN'),
      role('ra5', ACC.admin, 'quantri', null, 'QUAN_TRI_HE_THONG'),
    ];
    const phong = (personName: string, reviewerPersonId: string | null, reviewerName: string | null): PersonPlacement => ({ personName, unitName: 'Phòng Tổ chức cán bộ', positionTitle: 'Chức danh', reviewerPersonId, reviewerName });
    org.map.set(PERSON.leader, phong('Nguyễn Trưởng Phòng', PERSON.head, 'Trần Trưởng Ban')); // người đứng đầu phòng nên cấp trên xác nhận
    org.map.set(PERSON.staff, phong('Lê Chuyên Viên', PERSON.leader, 'Nguyễn Trưởng Phòng'));
    org.map.set(PERSON.staff2, phong('Phạm Chuyên Viên', PERSON.leader, 'Nguyễn Trưởng Phòng'));
    org.map.set(PERSON.head, { personName: 'Trần Trưởng Ban', unitName: 'Ban', positionTitle: 'Trưởng ban', reviewerPersonId: null, reviewerName: null }); // không có cấp trên

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccessReviewService,
        { provide: Clock, useValue: clock },
        { provide: AccessReviewRepository, useValue: repo },
        { provide: RoleSource, useValue: roles },
        { provide: ReviewOrgDirectory, useValue: org },
        { provide: ReviewExporter, useClass: FakeExporter },
        {
          provide: Notifier,
          useValue: {
            notify: async (personIds: (string | null | undefined)[], content: NotificationContent) => void sent.push({ personIds, content }),
            notifyPermitted: async (permission: string, _except: unknown, content: NotificationContent) => void permitted.push({ permission, content }),
          },
        },
        { provide: AuditService, useValue: { record: async (e: { action: string; details?: Record<string, unknown> }) => void audit.push(e) } },
      ],
    }).compile();
    service = moduleRef.get(AccessReviewService);
  });

  const create = () => service.create(ADMIN, { year: 2026, quarter: 4 });
  const itemOf = (username: string) => repo.rows.find((i) => i.username === username)!;

  describe('tạo đợt', () => {
    it('chụp mọi vai trò đang hiệu lực, giao cho lãnh đạo phụ trách hoặc quản trị dữ liệu, thông báo, ghi nhật ký', async () => {
      const view = await create();
      expect(view).toMatchObject({ label: 'Quý 4/2026', status: 'OPEN', counts: { total: 5, pending: 5, decided: 0 }, overdue: false });
      expect(view.dueDate).toBe('2026-10-19'); // mặc định 14 ngày

      expect(itemOf('chuyenvien1')).toMatchObject({ reviewerKind: 'LEADER', reviewerPersonId: PERSON.leader, reviewerName: 'Nguyễn Trưởng Phòng', personName: 'Lê Chuyên Viên', unitName: 'Phòng Tổ chức cán bộ' });
      expect(itemOf('truongphong')).toMatchObject({ reviewerKind: 'LEADER', reviewerPersonId: PERSON.head }); // lãnh đạo phòng thì cấp trên xác nhận
      expect(itemOf('truongban')).toMatchObject({ reviewerKind: 'DATA_ADMIN', reviewerPersonId: null }); // không có cấp trên
      expect(itemOf('quantri')).toMatchObject({ reviewerKind: 'DATA_ADMIN', personId: null, personName: null }); // không gắn cán bộ

      expect(sent.map((s) => s.personIds[0]).sort()).toEqual([PERSON.head, PERSON.leader]);
      expect(sent.find((s) => s.personIds[0] === PERSON.leader)!.content).toMatchObject({ type: 'ACCESS_REVIEW_ASSIGNED', link: `/access-reviews?open=${view.id}` });
      expect(permitted).toHaveLength(1);
      expect(permitted[0].permission).toBe('access-review:oversee');
      expect(audit.at(-1)).toMatchObject({ action: 'access-review.create', details: { items: 5, leaders: 2, fallback: 2 } });
    });

    it('từ chối quý trùng, quý hoặc hạn sai, không có vai trò nào', async () => {
      await create();
      await expect(create()).rejects.toBeInstanceOf(ConflictException);
      await expect(service.create(ADMIN, { year: 2026, quarter: 5 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(ADMIN, { year: 1999, quarter: 1 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(ADMIN, { year: 2027, quarter: 1, dueDate: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException); // hạn đã qua
      await expect(service.create(ADMIN, { year: 2027, quarter: 1, dueDate: '31/12/2026' })).rejects.toBeInstanceOf(BadRequestException);
      roles.live = [];
      await expect(service.create(ADMIN, { year: 2027, quarter: 2 })).rejects.toBeInstanceOf(ConflictException);
    });

    it('gợi ý quý hiện tại: chưa có đợt thì báo chưa, có rồi thì nêu mã đợt', async () => {
      expect(await service.suggestion()).toMatchObject({ year: 2026, quarter: 4, label: 'Quý 4/2026', exists: false, reviewId: null });
      const view = await create();
      expect(await service.suggestion()).toMatchObject({ exists: true, reviewId: view.id });
    });
  });

  describe('xem', () => {
    it('quản trị thấy mọi mục; lãnh đạo chỉ thấy mục được giao; người khác bị từ chối', async () => {
      const view = await create();
      expect((await service.get(ADMIN, view.id, MANAGE)).items).toHaveLength(5);
      expect((await service.get(DATA_ADMIN, view.id, OVERSEE)).items).toHaveLength(5);

      const mine = await service.get(LEADER, view.id, CONFIRM);
      expect(mine.items.map((i) => i.username).sort()).toEqual(['chuyenvien1', 'chuyenvien2']);
      expect(mine.review.counts.total).toBe(2);
      expect(mine.items.every((i) => i.canDecide)).toBe(true);

      await expect(service.get(actorOf('x', 'x', 'p-khac'), view.id, CONFIRM)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.get(ADMIN, 'khong-co', MANAGE)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('danh sách đợt: lãnh đạo chỉ thấy đợt có mục của mình; quản trị hệ thống thấy nhưng không có quyền quyết định', async () => {
      await create();
      expect(await service.list(LEADER, CONFIRM)).toHaveLength(1);
      expect(await service.list(actorOf('x', 'x', 'p-khac'), CONFIRM)).toHaveLength(0);
      const all = await service.list(ADMIN, MANAGE);
      expect(all).toHaveLength(1);
      const detail = await service.get(ADMIN, all[0].id, MANAGE);
      expect(detail.items.every((i) => !i.canDecide)).toBe(true); // quản trị hệ thống không xác nhận
    });
  });

  describe('xác nhận', () => {
    it('lãnh đạo giữ một vai trò; không cần lý do', async () => {
      await create();
      const out = await service.decide(LEADER, itemOf('chuyenvien1').id, { decision: 'KEEP' }, CONFIRM);
      expect(out).toMatchObject({ decision: 'KEEP', decidedBy: ACC.leader, revokeApplied: false });
      expect(roles.revoked).toEqual([]);
      expect(audit.at(-1)).toMatchObject({ action: 'access-review.item.decide', details: { decision: 'KEEP', username: 'chuyenvien1' } });
    });

    it('thu hồi thì thu hồi thật ngay, cần lý do, không đổi lại được', async () => {
      await create();
      const id = itemOf('chuyenvien1').id;
      await expect(service.decide(LEADER, id, { decision: 'REVOKE' }, CONFIRM)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.decide(LEADER, id, { decision: 'REVOKE', note: 'x' }, CONFIRM)).rejects.toBeInstanceOf(BadRequestException);

      const out = await service.decide(LEADER, id, { decision: 'REVOKE', note: 'Chuyển công tác' }, CONFIRM);
      expect(out).toMatchObject({ decision: 'REVOKE', note: 'Chuyển công tác', revokeApplied: true });
      expect(roles.revoked).toEqual(['ra2']);
      await expect(service.decide(LEADER, id, { decision: 'KEEP' }, CONFIRM)).rejects.toBeInstanceOf(ConflictException);
    });

    it('đổi từ giữ sang thu hồi được khi đợt còn mở', async () => {
      await create();
      const id = itemOf('chuyenvien2').id;
      await service.decide(LEADER, id, { decision: 'KEEP' }, CONFIRM);
      await service.decide(LEADER, id, { decision: 'REVOKE', note: 'Phát hiện thừa quyền' }, CONFIRM);
      expect(roles.revoked).toEqual(['ra3']);
    });

    it('tách quyền: không tự duyệt quyền của mình; chỉ người được giao mới xác nhận', async () => {
      await create();
      // Trưởng phòng được Trưởng ban xác nhận, không tự xác nhận được.
      await expect(service.decide(LEADER, itemOf('truongphong').id, { decision: 'KEEP' }, CONFIRM)).rejects.toBeInstanceOf(ForbiddenException);
      await service.decide(HEAD, itemOf('truongphong').id, { decision: 'KEEP' }, CONFIRM);
      // Trưởng ban không có cấp trên nên do quản trị dữ liệu xác nhận; chính Trưởng ban không tự làm được.
      await expect(service.decide(HEAD, itemOf('truongban').id, { decision: 'KEEP' }, CONFIRM)).rejects.toBeInstanceOf(ForbiddenException);
      await service.decide(DATA_ADMIN, itemOf('truongban').id, { decision: 'KEEP' }, OVERSEE);
      // Người không phụ trách mục chuyên viên.
      await expect(service.decide(HEAD, itemOf('chuyenvien1').id, { decision: 'KEEP' }, CONFIRM)).rejects.toBeInstanceOf(ForbiddenException);
      // Quản trị hệ thống tạo đợt nhưng không xác nhận.
      await expect(service.decide(ADMIN, itemOf('chuyenvien1').id, { decision: 'KEEP' }, MANAGE)).rejects.toBeInstanceOf(ForbiddenException);
      // Quản trị dữ liệu không xác nhận mục đã giao cho lãnh đạo.
      await expect(service.decide(DATA_ADMIN, itemOf('chuyenvien1').id, { decision: 'KEEP' }, OVERSEE)).rejects.toBeInstanceOf(ForbiddenException);
      // Quản trị dữ liệu không tự duyệt quyền của mình dù mục thuộc nhóm quản trị dữ liệu.
      roles.live.push(role('ra6', ACC.dataAdmin, 'quantridulieu', null, 'QUAN_TRI_DU_LIEU'));
      const second = await service.create(ADMIN, { year: 2027, quarter: 1 });
      const own = (await repo.items(second.id)).find((i) => i.username === 'quantridulieu')!;
      await expect(service.decide(DATA_ADMIN, own.id, { decision: 'KEEP' }, OVERSEE)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.decide(DATA_ADMIN, 'khong-co', { decision: 'KEEP' }, OVERSEE)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('đóng và nhắc', () => {
    it('đóng đợt: mục chưa xác nhận được giữ nguyên, không tự thu hồi; đóng rồi thì không xác nhận được nữa', async () => {
      const view = await create();
      await service.decide(LEADER, itemOf('chuyenvien1').id, { decision: 'KEEP' }, CONFIRM);
      const closed = await service.close(ADMIN, view.id);
      expect(closed).toMatchObject({ status: 'CLOSED', counts: { total: 5, decided: 1, pending: 4 }, closedBy: ACC.admin });
      expect(roles.revoked).toEqual([]);
      expect(audit.at(-1)).toMatchObject({ action: 'access-review.close', details: { pending: 4 } });
      await expect(service.close(ADMIN, view.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.decide(LEADER, itemOf('chuyenvien2').id, { decision: 'KEEP' }, CONFIRM)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.remind(ADMIN, view.id)).rejects.toBeInstanceOf(ConflictException);
      const detail = await service.get(LEADER, view.id, CONFIRM);
      expect(detail.items.every((i) => !i.canDecide)).toBe(true);
    });

    it('nhắc trước hạn: chỉ nhắc người còn mục chưa xác nhận, loại thông báo là nhắc', async () => {
      const view = await create();
      sent.length = 0;
      permitted.length = 0;
      await service.decide(LEADER, itemOf('chuyenvien1').id, { decision: 'KEEP' }, CONFIRM);
      await service.decide(LEADER, itemOf('chuyenvien2').id, { decision: 'KEEP' }, CONFIRM);

      const out = await service.remind(ADMIN, view.id);
      expect(out).toEqual({ reminded: 1, overdue: false, pending: 3 }); // chỉ Trưởng ban còn mục (mục của Trưởng phòng)
      expect(sent).toHaveLength(1);
      expect(sent[0].personIds).toEqual([PERSON.head]);
      expect(sent[0].content.type).toBe('ACCESS_REVIEW_REMINDER');
      expect(permitted.map((p) => p.permission)).toEqual(['access-review:oversee']); // còn 2 mục của quản trị dữ liệu
      expect(audit.at(-1)).toMatchObject({ action: 'access-review.remind', details: { pending: 3, overdue: false } });
    });

    it('quá hạn: báo quá hạn cho người phụ trách, quản trị dữ liệu và quản trị hệ thống; đánh dấu overdue; không tự thu hồi', async () => {
      const view = await create();
      clock.current = new Date('2026-10-25T03:00:00Z'); // sau hạn 2026-10-19
      sent.length = 0;
      permitted.length = 0;

      const out = await service.remind(ADMIN, view.id);
      expect(out).toMatchObject({ overdue: true, pending: 5 });
      expect(sent.every((s) => s.content.type === 'ACCESS_REVIEW_OVERDUE')).toBe(true);
      expect(permitted.map((p) => p.permission).sort()).toEqual(['access-review:manage', 'access-review:oversee']);
      expect((await service.list(ADMIN, MANAGE))[0].overdue).toBe(true);
      expect(roles.revoked).toEqual([]);
    });
  });

  it('xuất Excel ghi nhật ký loại xuất tệp', async () => {
    const view = await create();
    const file = await service.export(ADMIN, view.id);
    expect(file.filename).toBe('ra-soat-quyen-quy-4-2026.xlsx');
    expect(file.buffer.length).toBeGreaterThan(0);
    expect(audit.at(-1)).toMatchObject({ action: 'access-review.export', details: { items: 5, format: 'xlsx' } });
  });
});
