import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../security/index.js';
import { OrgDirectory } from './evaluation.ports.js';
import type { Actor } from './evaluation.service.js';
import { checkRatingEvent, RatingEventRepository } from './rating-events.js';
import type { DisciplineForm, DisciplineReason, DisciplineSystem, RatingEventKind, RatingEventModel } from './rating-events.js';

export interface RatingEventInput {
  kind: RatingEventKind;
  effectiveDate: string;
  decisionNo: string;
  form?: DisciplineForm | null;
  system?: DisciplineSystem | null;
  reason?: DisciplineReason | null;
  note?: string | null;
}

/**
 * Ghi nhận sự kiện ảnh hưởng xếp loại (ADR-055). Văn phòng ghi nhận (quyền kiểm ở lớp trình bày). Đây là thông tin nhạy cảm nên
 * chỉ chính cán bộ, cấp trên theo cây vị trí và người có quyền xem toàn bộ được xem.
 */
@Injectable()
export class RatingEventService {
  constructor(
    private readonly events: RatingEventRepository,
    private readonly org: OrgDirectory,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor, personId: string, year: number, canReadAll: boolean): Promise<RatingEventModel[]> {
    await this.assertCanView(actor, personId, canReadAll);
    return this.events.findByPerson(personId, `${year}-01-01`, `${year}-12-31`);
  }

  async create(actor: Actor, personId: string, input: RatingEventInput): Promise<RatingEventModel> {
    if (!(await this.org.positionOf(personId))) throw new NotFoundException(`Không tìm thấy cán bộ đang giữ vị trí công tác: ${personId}`);
    const created = await this.events.create({ ...checkRatingEvent(input), personId, createdBy: actor.id });
    await this.audit.record({
      action: 'evaluation.rating-event.create',
      outcome: 'SUCCESS',
      targetType: 'person',
      targetId: personId,
      details: { id: created.id, kind: created.kind, effectiveDate: created.effectiveDate, decisionNo: created.decisionNo, form: created.form, system: created.system, reason: created.reason },
    });
    return created;
  }

  /** Xóa bản ghi nhập nhầm; có nhật ký. Hồ sơ đã chốt giữ nguyên kết quả đã tính. */
  async remove(actor: Actor, id: string): Promise<void> {
    const event = await this.events.findById(id);
    if (!event) throw new NotFoundException(`Không tìm thấy sự kiện: ${id}`);
    await this.events.delete(id);
    await this.audit.record({
      action: 'evaluation.rating-event.delete',
      outcome: 'SUCCESS',
      targetType: 'person',
      targetId: event.personId,
      details: { id, kind: event.kind, effectiveDate: event.effectiveDate, decisionNo: event.decisionNo },
    });
  }

  private async assertCanView(actor: Actor, personId: string, canReadAll: boolean): Promise<void> {
    if (canReadAll || actor.personId === personId) return;
    if (actor.personId && (await this.org.superiorsOf(personId)).some((s) => s.personId === actor.personId)) return;
    throw new ForbiddenException('Bạn không xem được thông tin kỷ luật, kết luận của cán bộ này');
  }
}
