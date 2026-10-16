import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import { AuditService } from '../../security/index.js';
import { countsOf, dateOf, quarterOf } from './access-review.model.js';
import type {
  AccessReviewDetail,
  AccessReviewItemModel,
  AccessReviewModel,
  AccessReviewView,
  NewAccessReviewItem,
  ReviewDecision,
} from './access-review.model.js';
import { AccessReviewRepository, ReviewExporter, ReviewOrgDirectory, RoleSource } from './access-review.ports.js';

export interface ReviewActor {
  id: string;
  username: string;
  personId: string | null;
}

/** Quyền của người gọi (lấy từ vai trò): `manage` tạo, đóng, nhắc, xuất; `oversee` xem mọi đợt và xác nhận mục không có lãnh đạo; `confirm` xác nhận mục được giao. */
export interface ReviewAccess {
  manage: boolean;
  oversee: boolean;
  confirm: boolean;
}

export interface CreateReviewInput {
  year: number;
  quarter: number;
  /** YYYY-MM-DD; bỏ trống thì 14 ngày kể từ hôm nay. */
  dueDate?: string;
  note?: string | null;
}

const DEFAULT_DUE_DAYS = 14;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rà soát quyền định kỳ (ADR-044): quản trị hệ thống tạo đợt theo quý, chụp mọi vai trò đang có hiệu lực, mỗi mục giao
 * cho lãnh đạo phụ trách (hoặc quản trị dữ liệu nếu không có), người đó giữ hoặc thu hồi. Không ai tự duyệt quyền của chính mình.
 */
@Injectable()
export class AccessReviewService {
  constructor(
    private readonly reviews: AccessReviewRepository,
    private readonly roles: RoleSource,
    private readonly org: ReviewOrgDirectory,
    private readonly exporter: ReviewExporter,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Gợi ý đầu quý: quý hiện tại đã có đợt chưa (A4.5). */
  async suggestion(): Promise<{ year: number; quarter: number; label: string; exists: boolean; reviewId: string | null }> {
    const { year, quarter } = quarterOf(this.clock.now());
    const existing = await this.reviews.findByQuarter(year, quarter);
    return { year, quarter, label: labelOf(year, quarter), exists: existing !== null, reviewId: existing?.id ?? null };
  }

  async create(actor: ReviewActor, input: CreateReviewInput): Promise<AccessReviewView> {
    if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new BadRequestException('Năm không hợp lệ');
    if (!Number.isInteger(input.quarter) || input.quarter < 1 || input.quarter > 4) throw new BadRequestException('Quý từ 1 đến 4');
    const now = this.clock.now();
    const today = dateOf(now);
    const dueDate = input.dueDate ?? dateOf(new Date(now.getTime() + DEFAULT_DUE_DAYS * 86_400_000));
    if (!DATE.test(dueDate) || Number.isNaN(Date.parse(dueDate))) throw new BadRequestException('Hạn xác nhận có dạng YYYY-MM-DD');
    if (dueDate < today) throw new BadRequestException('Hạn xác nhận đã qua');
    const label = labelOf(input.year, input.quarter);
    if (await this.reviews.findByQuarter(input.year, input.quarter)) throw new ConflictException(`Đã có đợt rà soát ${label}`);

    const live = await this.roles.liveRoles();
    if (live.length === 0) throw new ConflictException('Không có vai trò nào đang có hiệu lực để rà soát');
    const placements = await this.org.placements([...new Set(live.flatMap((r) => (r.personId ? [r.personId] : [])))]);

    const items: NewAccessReviewItem[] = live.map((r) => {
      const p = r.personId ? placements.get(r.personId) : undefined;
      const leader = p?.reviewerPersonId ?? null;
      return {
        accountId: r.accountId,
        username: r.username,
        personId: r.personId,
        personName: p?.personName ?? null,
        unitName: p?.unitName ?? null,
        positionTitle: p?.positionTitle ?? null,
        role: r.role,
        roleAssignmentId: r.roleAssignmentId,
        roleValidFrom: r.validFrom,
        roleValidTo: r.validTo,
        reviewerKind: leader ? 'LEADER' : 'DATA_ADMIN',
        reviewerPersonId: leader,
        reviewerName: leader ? (p?.reviewerName ?? null) : null,
      };
    });

    const created = await this.reviews.create(
      { year: input.year, quarter: input.quarter, label, dueDate, note: input.note?.trim() || null, createdBy: actor.id, createdAt: now },
      items,
    );
    const leaders = new Set(items.flatMap((i) => (i.reviewerPersonId ? [i.reviewerPersonId] : [])));
    const fallback = items.filter((i) => i.reviewerKind === 'DATA_ADMIN').length;
    for (const personId of leaders) {
      const n = items.filter((i) => i.reviewerPersonId === personId).length;
      await this.notifier.notify([personId], {
        type: 'ACCESS_REVIEW_ASSIGNED',
        title: `Rà soát quyền ${label}: ${n} vai trò cần bạn xác nhận trước ${dueDate}`,
        link: `/access-reviews?open=${created.id}`,
      });
    }
    if (fallback > 0) {
      await this.notifier.notifyPermitted('access-review:oversee', null, {
        type: 'ACCESS_REVIEW_ASSIGNED',
        title: `Rà soát quyền ${label}: ${fallback} vai trò không có lãnh đạo phụ trách, cần xác nhận trước ${dueDate}`,
        link: `/access-reviews?open=${created.id}`,
      });
    }
    await this.audit.record({
      action: 'access-review.create',
      outcome: 'SUCCESS',
      targetType: 'access_review',
      targetId: created.id,
      details: { label, dueDate, items: items.length, leaders: leaders.size, fallback },
    });
    return this.view(created, await this.reviews.items(created.id));
  }

  async list(actor: ReviewActor, access: ReviewAccess): Promise<AccessReviewView[]> {
    const out: AccessReviewView[] = [];
    for (const review of await this.reviews.findAll()) {
      const all = await this.reviews.items(review.id);
      const visible = this.visibleItems(actor, access, all);
      if (visible.length === 0 && !(access.manage || access.oversee)) continue;
      out.push(this.view(review, visible));
    }
    return out;
  }

  async get(actor: ReviewActor, id: string, access: ReviewAccess): Promise<AccessReviewDetail> {
    const review = await this.require(id);
    const visible = this.visibleItems(actor, access, await this.reviews.items(id));
    if (visible.length === 0 && !(access.manage || access.oversee)) throw new ForbiddenException('Bạn không có mục nào trong đợt rà soát này');
    return {
      review: this.view(review, visible),
      items: visible.map((i) => ({ ...i, canDecide: review.status === 'OPEN' && this.canDecide(actor, access, i) })),
    };
  }

  /** Giữ hoặc thu hồi một vai trò. Thu hồi thực hiện ngay, không hoàn tác được; đổi KEEP thành REVOKE khi đợt còn mở thì được. */
  async decide(actor: ReviewActor, itemId: string, input: { decision: ReviewDecision; note?: string | null }, access: ReviewAccess): Promise<AccessReviewItemModel> {
    const item = await this.reviews.findItem(itemId);
    if (!item) throw new NotFoundException(`Không tìm thấy mục rà soát: ${itemId}`);
    const review = await this.require(item.reviewId);
    if (review.status !== 'OPEN') throw new ConflictException('Đợt rà soát đã đóng');
    if (item.accountId === actor.id) throw new ForbiddenException('Không được tự duyệt quyền của chính mình');
    if (!this.hasAuthority(actor, access, item)) throw new ForbiddenException('Mục này không do bạn phụ trách');
    if (item.revokeApplied) throw new ConflictException('Vai trò đã được thu hồi, không đổi quyết định được');
    const note = input.note?.trim() || null;
    if (input.decision === 'REVOKE' && (note?.length ?? 0) < 3) throw new BadRequestException('Cần nêu lý do khi thu hồi');

    let revokeApplied = false;
    if (input.decision === 'REVOKE') {
      await this.roles.revoke(item.accountId, item.roleAssignmentId);
      revokeApplied = true;
    }
    const updated = await this.reviews.decideItem(itemId, { decision: input.decision, decidedBy: actor.id, decidedAt: this.clock.now(), note, revokeApplied });
    await this.audit.record({
      action: 'access-review.item.decide',
      outcome: 'SUCCESS',
      targetType: 'access_review_item',
      targetId: itemId,
      details: { review: review.label, username: item.username, role: item.role, decision: input.decision, note, reviewerKind: item.reviewerKind },
    });
    return updated;
  }

  /** Đóng đợt. Mục chưa xác nhận được giữ nguyên (không tự thu hồi) và liệt kê trong kết quả. */
  async close(actor: ReviewActor, id: string): Promise<AccessReviewView> {
    const review = await this.require(id);
    if (review.status !== 'OPEN') throw new ConflictException('Đợt rà soát đã đóng');
    const closed = await this.reviews.close(id, actor.id, this.clock.now());
    const items = await this.reviews.items(id);
    const counts = countsOf(items);
    await this.audit.record({
      action: 'access-review.close',
      outcome: 'SUCCESS',
      targetType: 'access_review',
      targetId: id,
      details: { label: review.label, ...counts },
    });
    return this.view(closed, items);
  }

  /**
   * Nhắc những người còn mục chưa xác nhận. Đã quá hạn thì báo thêm cho quản trị hệ thống và quản trị dữ liệu;
   * hệ thống không tự thu hồi (ADR-044).
   */
  async remind(actor: ReviewActor, id: string): Promise<{ reminded: number; overdue: boolean; pending: number }> {
    const review = await this.require(id);
    if (review.status !== 'OPEN') throw new ConflictException('Đợt rà soát đã đóng');
    const pending = (await this.reviews.items(id)).filter((i) => i.decision === null);
    const overdue = dateOf(this.clock.now()) > review.dueDate;
    const link = `/access-reviews?open=${id}`;
    const byLeader = new Map<string, number>();
    for (const i of pending) if (i.reviewerPersonId) byLeader.set(i.reviewerPersonId, (byLeader.get(i.reviewerPersonId) ?? 0) + 1);
    for (const [personId, n] of byLeader) {
      await this.notifier.notify([personId], {
        type: overdue ? 'ACCESS_REVIEW_OVERDUE' : 'ACCESS_REVIEW_REMINDER',
        title: overdue ? `Rà soát quyền ${review.label} đã quá hạn ${review.dueDate}: còn ${n} vai trò chưa xác nhận` : `Nhắc: rà soát quyền ${review.label} còn ${n} vai trò chưa xác nhận, hạn ${review.dueDate}`,
        link,
      });
    }
    const fallback = pending.filter((i) => i.reviewerKind === 'DATA_ADMIN').length;
    if (fallback > 0) {
      await this.notifier.notifyPermitted('access-review:oversee', null, {
        type: overdue ? 'ACCESS_REVIEW_OVERDUE' : 'ACCESS_REVIEW_REMINDER',
        title: `Rà soát quyền ${review.label}: còn ${fallback} vai trò chưa có người xác nhận, hạn ${review.dueDate}`,
        link,
      });
    }
    if (overdue && pending.length > 0) {
      await this.notifier.notifyPermitted('access-review:manage', null, {
        type: 'ACCESS_REVIEW_OVERDUE',
        title: `Rà soát quyền ${review.label} quá hạn ${review.dueDate}: còn ${pending.length} vai trò chưa xác nhận`,
        link,
      });
    }
    await this.audit.record({
      action: 'access-review.remind',
      outcome: 'SUCCESS',
      targetType: 'access_review',
      targetId: id,
      details: { label: review.label, pending: pending.length, leaders: byLeader.size, fallback, overdue },
    });
    return { reminded: byLeader.size, overdue, pending: pending.length };
  }

  /** Xuất kết quả đợt ra Excel làm hồ sơ kiểm toán. */
  async export(actor: ReviewActor, id: string): Promise<{ filename: string; contentType: string; buffer: Buffer }> {
    const review = await this.require(id);
    const items = await this.reviews.items(id);
    const buffer = await this.exporter.renderExcel(review, items);
    await this.audit.record({
      action: 'access-review.export',
      outcome: 'SUCCESS',
      targetType: 'access_review',
      targetId: id,
      details: { label: review.label, items: items.length, format: 'xlsx' },
    });
    return {
      filename: `ra-soat-quyen-quy-${review.quarter}-${review.year}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    };
  }

  private hasAuthority(actor: ReviewActor, access: ReviewAccess, item: AccessReviewItemModel): boolean {
    if (item.reviewerKind === 'DATA_ADMIN') return access.oversee;
    return access.confirm && actor.personId !== null && item.reviewerPersonId === actor.personId;
  }

  private canDecide(actor: ReviewActor, access: ReviewAccess, item: AccessReviewItemModel): boolean {
    return item.accountId !== actor.id && !item.revokeApplied && this.hasAuthority(actor, access, item);
  }

  /** Quản trị hệ thống và quản trị dữ liệu thấy mọi mục; lãnh đạo chỉ thấy mục được giao cho mình. */
  private visibleItems(actor: ReviewActor, access: ReviewAccess, all: AccessReviewItemModel[]): AccessReviewItemModel[] {
    if (access.manage || access.oversee) return all;
    if (!actor.personId) return [];
    return all.filter((i) => i.reviewerKind === 'LEADER' && i.reviewerPersonId === actor.personId);
  }

  private view(review: AccessReviewModel, items: readonly AccessReviewItemModel[]): AccessReviewView {
    const counts = countsOf(items);
    return { ...review, counts, overdue: review.status === 'OPEN' && counts.pending > 0 && dateOf(this.clock.now()) > review.dueDate };
  }

  private async require(id: string): Promise<AccessReviewModel> {
    const review = await this.reviews.findById(id);
    if (!review) throw new NotFoundException(`Không tìm thấy đợt rà soát: ${id}`);
    return review;
  }
}

function labelOf(year: number, quarter: number): string {
  return `Quý ${quarter}/${year}`;
}
