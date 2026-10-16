import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { Notifier } from '../../../common/notifier.js';
import { AuditService } from '../../security/index.js';
import type { Actor } from './evaluation.service.js';
import { todayVn } from './rating-deadline.js';
import { COMPLAINT_KINDS, COMPLAINT_OUTCOMES, UnitComplaintRepository } from './unit-complaint.js';
import type { ComplaintKind, ComplaintOutcome, UnitComplaintModel } from './unit-complaint.js';
import { UnitEvaluationService } from './unit-evaluation.service.js';
import type { UnitAccess } from './unit-evaluation.service.js';

/** Quyền của người gọi: quyền xem hồ sơ tập thể và `complaint:manage` (Văn phòng ghi nhận). */
export interface ComplaintAccess extends UnitAccess {
  manage: boolean;
}

export interface ComplaintInput {
  kind: ComplaintKind;
  content: string;
  source?: string | null;
  /** YYYY-MM-DD; mặc định là hôm nay. */
  receivedOn?: string;
}

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Khiếu nại, phản ánh về tập thể (ADR-038, Nghị định 335 Điều 9.2.a). Văn phòng ghi nhận; người có thẩm quyền công nhận hồ sơ
 * chỉ đạo kiểm tra, xác minh rồi kết luận. Khiếu nại chưa kết luận thì hồ sơ của đơn vị chưa công nhận được.
 */
@Injectable()
export class UnitComplaintService {
  constructor(
    private readonly complaints: UnitComplaintRepository,
    private readonly units: UnitEvaluationService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  /** Văn phòng ghi nhận khiếu nại, phản ánh. Hồ sơ đã công nhận vẫn ghi nhận được nhưng không mở khóa hồ sơ. */
  async create(actor: Actor, evaluationId: string, input: ComplaintInput, access: ComplaintAccess): Promise<UnitComplaintModel> {
    if (!access.manage) throw new ForbiddenException('Chỉ Văn phòng được ghi nhận khiếu nại, phản ánh');
    const ctx = await this.units.authorityOn(actor, evaluationId, access);
    if (!COMPLAINT_KINDS.includes(input.kind)) throw new BadRequestException('Loại khiếu nại, phản ánh không hợp lệ');
    const content = input.content?.trim() ?? '';
    if (content.length < 10) throw new BadRequestException('Cần nêu nội dung khiếu nại, phản ánh (ít nhất 10 ký tự)');
    const receivedOn = input.receivedOn ?? todayVn(this.clock.now());
    if (!isDate(receivedOn)) throw new BadRequestException('Ngày nhận phải có dạng YYYY-MM-DD');

    const created = await this.complaints.create({
      unitId: ctx.unit.id,
      periodId: ctx.period.id,
      kind: input.kind,
      content,
      source: input.source?.trim() || null,
      receivedOn,
      createdBy: actor.id,
    });
    await this.audit.record({
      action: 'unit-complaint.create',
      outcome: 'SUCCESS',
      targetType: 'unit_complaint',
      targetId: created.id,
      details: { period: ctx.period.label, unit: ctx.unit.code, kind: created.kind },
    });
    // Tiêu đề không nêu nội dung vì khiếu nại nhạy cảm (ADR-038 mục 6).
    const content2 = { type: 'COMPLAINT_RECEIVED' as const, title: `Có phản ánh về ${ctx.unit.name} năm ${ctx.period.label} cần chỉ đạo kiểm tra, xác minh`, link: `/unit-evaluations/${evaluationId}` };
    if (ctx.unit.parentId === null) await this.notifier.notifyPermitted('evaluation:decide-ban', null, content2);
    else await this.notifier.notify([ctx.approverPersonId], content2);
    return created;
  }

  /** Xem khiếu nại của một hồ sơ: Văn phòng, người phê duyệt, người thẩm định; người đứng đầu và thành viên không xem. */
  async list(actor: Actor, evaluationId: string, access: ComplaintAccess): Promise<UnitComplaintModel[]> {
    const ctx = await this.units.authorityOn(actor, evaluationId, access);
    if (!access.manage && !ctx.isApprover && !ctx.isReviewer) throw new ForbiddenException('Bạn không được xem khiếu nại, phản ánh của đơn vị này');
    return this.complaints.findByUnitAndPeriod(ctx.unit.id, ctx.period.id);
  }

  /** Người có thẩm quyền công nhận chỉ đạo kiểm tra, xác minh (Điều 9.2.a). */
  async direct(actor: Actor, id: string, input: { assignee: string; dueDate?: string | null }, access: ComplaintAccess): Promise<UnitComplaintModel> {
    const { complaint, ctx } = await this.loadForDecision(actor, id, access);
    if (complaint.status !== 'RECEIVED') throw new ConflictException(`Khiếu nại đang ở trạng thái ${complaint.status}, không chỉ đạo xác minh được`);
    const assignee = input.assignee?.trim() ?? '';
    if (assignee.length < 3) throw new BadRequestException('Cần nêu người hoặc bộ phận được giao kiểm tra, xác minh');
    if (input.dueDate && !isDate(input.dueDate)) throw new BadRequestException('Hạn xác minh phải có dạng YYYY-MM-DD');
    const updated = await this.complaints.update(id, {
      status: 'VERIFYING',
      assignee,
      verifyDue: input.dueDate || null,
      verifyDirectedBy: actor.id,
      verifyDirectedAt: this.clock.now(),
    });
    await this.audit.record({
      action: 'unit-complaint.verify',
      outcome: 'SUCCESS',
      targetType: 'unit_complaint',
      targetId: id,
      details: { period: ctx.period.label, unit: ctx.unit.code, assignee, dueDate: input.dueDate ?? null },
    });
    return updated;
  }

  /** Kết luận: xác minh đúng hoặc không đúng. Kết luận đúng không tự hạ xếp loại (ADR-038 mục 5). */
  async close(actor: Actor, id: string, input: { outcome: ComplaintOutcome; conclusion: string }, access: ComplaintAccess): Promise<UnitComplaintModel> {
    const { complaint, ctx } = await this.loadForDecision(actor, id, access);
    if (complaint.status !== 'VERIFYING') throw new ConflictException('Phải chỉ đạo kiểm tra, xác minh trước khi kết luận');
    if (!COMPLAINT_OUTCOMES.includes(input.outcome)) throw new BadRequestException('Kết quả xác minh không hợp lệ');
    const conclusion = input.conclusion?.trim() ?? '';
    if (conclusion.length < 10) throw new BadRequestException('Cần nêu nội dung kết luận xác minh (ít nhất 10 ký tự)');
    const updated = await this.complaints.update(id, {
      status: 'CLOSED',
      outcome: input.outcome,
      conclusion,
      closedBy: actor.id,
      closedAt: this.clock.now(),
    });
    await this.audit.record({
      action: 'unit-complaint.close',
      outcome: 'SUCCESS',
      targetType: 'unit_complaint',
      targetId: id,
      details: { period: ctx.period.label, unit: ctx.unit.code, result: input.outcome },
    });
    return updated;
  }

  private async loadForDecision(actor: Actor, id: string, access: ComplaintAccess) {
    const complaint = await this.complaints.findById(id);
    if (!complaint) throw new NotFoundException(`Không tìm thấy khiếu nại, phản ánh: ${id}`);
    const evaluationId = await this.units.evaluationIdOf(complaint.periodId, complaint.unitId);
    if (!evaluationId) throw new NotFoundException('Không tìm thấy hồ sơ đánh giá tập thể của khiếu nại này');
    const ctx = await this.units.authorityOn(actor, evaluationId, access);
    // Chỉ người có thẩm quyền công nhận (Điều 9.2.a); Văn phòng chỉ ghi nhận, không tự kết luận.
    if (!ctx.isApprover) throw new ForbiddenException('Chỉ người có thẩm quyền công nhận xếp loại được chỉ đạo xác minh và kết luận');
    return { complaint, ctx };
  }
}
