import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { isCurrent, MAX_LEVEL, MIN_LEVEL } from './org.model.js';
import type { NewPosition, PositionModel, PositionPatch } from './org.model.js';
import { AssignmentRepository, PositionRepository } from './org.ports.js';
import { UnitService } from './unit.service.js';

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,79}$/;
const SUPPORT_NOT_LEADER = 'Vị trí hỗ trợ, phục vụ không đồng thời là vị trí lãnh đạo, quản lý';

@Injectable()
export class PositionService {
  constructor(
    private readonly positions: PositionRepository,
    private readonly assignments: AssignmentRepository,
    private readonly units: UnitService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Mọi vị trí, kể cả đã ngừng (báo cáo kỳ cũ vẫn cần). */
  list(filter?: { unitId?: string }): Promise<PositionModel[]> {
    return this.positions.findAll(filter);
  }

  async listActive(filter?: { unitId?: string }): Promise<PositionModel[]> {
    return (await this.positions.findAll(filter)).filter((p) => p.status === 'ACTIVE');
  }

  async get(id: string): Promise<PositionModel> {
    const position = await this.positions.findById(id);
    if (!position) throw new NotFoundException(`Không tìm thấy vị trí việc làm: ${id}`);
    return position;
  }

  findByCode(code: string): Promise<PositionModel | null> {
    return this.positions.findByCode(code);
  }

  async create(input: NewPosition): Promise<PositionModel> {
    if (!CODE_PATTERN.test(input.code)) {
      throw new BadRequestException('Mã vị trí gồm 3–80 ký tự: chữ hoa, số, gạch nối');
    }
    if (await this.positions.findByCode(input.code)) {
      throw new ConflictException(`Mã vị trí đã tồn tại: ${input.code}`);
    }
    if (input.isSupport && input.isLeader) throw new BadRequestException(SUPPORT_NOT_LEADER);
    await this.assertUnitActive(input.unitId);
    const all = await this.positions.findAll();
    this.assertTreeRules(input, null, all);
    this.assertParentActive(input.reportsToPositionId, all);

    const created = await this.positions.create(input.isSupport && input.isLeader === undefined ? { ...input, isLeader: false } : input);
    await this.audit.record({
      action: 'position.create',
      outcome: 'SUCCESS',
      targetType: 'position',
      targetId: created.id,
      details: { code: created.code, title: created.title, level: created.level, isLeader: created.isLeader, isSupport: created.isSupport, reportsTo: created.reportsToPositionId },
    });
    return created;
  }

  async update(id: string, patch: PositionPatch): Promise<PositionModel> {
    const current = await this.get(id);
    if (patch.unitId !== undefined && patch.unitId !== current.unitId) await this.assertUnitActive(patch.unitId);
    const after: PositionModel = { ...current, ...patch };
    if (after.isSupport && after.isLeader) throw new BadRequestException(SUPPORT_NOT_LEADER);
    const all = await this.positions.findAll();
    this.assertTreeRules(after, current.id, all);
    if (patch.reportsToPositionId !== undefined && patch.reportsToPositionId !== current.reportsToPositionId) {
      this.assertParentActive(patch.reportsToPositionId, all);
    }

    const before = pick(current, patch); // chụp trước khi cập nhật
    const updated = await this.positions.update(id, patch);
    await this.audit.record({
      action: 'position.update',
      outcome: 'SUCCESS',
      targetType: 'position',
      targetId: id,
      details: { code: current.code, changed: Object.keys(patch), before, after: pick(updated, patch) },
    });
    return updated;
  }

  private assertParentActive(parentId: string | null, all: PositionModel[]): void {
    if (parentId && all.find((p) => p.id === parentId)?.status === 'INACTIVE') {
      throw new ConflictException('Vị trí cấp trên đã ngừng sử dụng');
    }
  }

  private async assertUnitActive(unitId: string): Promise<void> {
    const unit = await this.units.get(unitId);
    if (unit.status !== 'ACTIVE') throw new ConflictException('Đơn vị đã ngừng sử dụng');
  }

  /**
   * "Xóa" vị trí = chuyển sang INACTIVE (lịch sử phân công, hồ sơ đánh giá được giữ). Chỉ ngừng được khi
   * không còn cấp dưới đang hoạt động báo cáo cho nó và không còn người đang giữ.
   */
  async deactivate(id: string, reason?: string): Promise<PositionModel> {
    const position = await this.get(id);
    if (position.status === 'INACTIVE') throw new ConflictException('Vị trí đã ngừng sử dụng');
    const all = await this.positions.findAll();
    if (all.some((p) => p.reportsToPositionId === id && p.status === 'ACTIVE')) {
      throw new ConflictException('Vị trí còn cấp dưới đang hoạt động báo cáo cho nó nên chưa ngừng được');
    }
    const now = this.clock.now();
    const holders = (await this.assignments.findByPosition(id)).filter((a) => isCurrent(a, now) || a.validFrom > now);
    if (holders.length > 0) {
      throw new ConflictException('Vị trí còn người đang giữ hoặc đã có phân công trong tương lai; hãy kết thúc phân công trước');
    }
    const note = reason?.trim() || null;
    const updated = await this.positions.setStatus(id, { status: 'INACTIVE', inactiveAt: now, inactiveReason: note });
    await this.audit.record({
      action: 'position.deactivate',
      outcome: 'SUCCESS',
      targetType: 'position',
      targetId: id,
      details: { code: position.code, title: position.title, level: position.level, reason: note },
    });
    return updated;
  }

  /** Kích hoạt lại vị trí đã ngừng; đơn vị và vị trí cấp trên (nếu có) phải đang hoạt động. */
  async reactivate(id: string): Promise<PositionModel> {
    const position = await this.get(id);
    if (position.status === 'ACTIVE') throw new ConflictException('Vị trí đang hoạt động');
    await this.assertUnitActive(position.unitId);
    if (position.reportsToPositionId) {
      const parent = await this.positions.findById(position.reportsToPositionId);
      if (parent && parent.status !== 'ACTIVE') throw new ConflictException('Vị trí cấp trên đã ngừng sử dụng; hãy kích hoạt vị trí cấp trên trước');
    }
    const updated = await this.positions.setStatus(id, { status: 'ACTIVE', inactiveAt: null, inactiveReason: null });
    await this.audit.record({
      action: 'position.reactivate',
      outcome: 'SUCCESS',
      targetType: 'position',
      targetId: id,
      details: { code: position.code, title: position.title },
    });
    return updated;
  }

  /** Các vị trí cấp dưới: chỉ trực tiếp, hoặc toàn bộ cây con. */
  async subordinates(positionId: string, options: { direct: boolean }): Promise<PositionModel[]> {
    await this.get(positionId);
    const all = await this.positions.findAll();
    const byParent = groupByParent(all);
    const result: PositionModel[] = [];
    const queue = [...(byParent.get(positionId) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      result.push(next);
      if (!options.direct) queue.push(...(byParent.get(next.id) ?? []));
    }
    return result;
  }

  /** Chuỗi cấp trên, từ cấp trên trực tiếp lên đến gốc. */
  async chain(positionId: string): Promise<PositionModel[]> {
    const all = await this.positions.findAll();
    const byId = new Map(all.map((p) => [p.id, p]));
    const start = byId.get(positionId);
    if (!start) throw new NotFoundException(`Không tìm thấy vị trí việc làm: ${positionId}`);
    const chain: PositionModel[] = [];
    for (let p = start.reportsToPositionId ? byId.get(start.reportsToPositionId) : undefined; p; ) {
      chain.push(p);
      p = p.reportsToPositionId ? byId.get(p.reportsToPositionId) : undefined;
    }
    return chain;
  }

  /**
   * Bất biến của cây (ADR-012 mục 3): cấp 1 không có cấp trên; cấp khác bắt buộc có cấp trên với
   * số cấp nhỏ hơn; mọi cấp dưới hiện có phải có số cấp lớn hơn. Số cấp tăng dần xuống dưới nên không có vòng lặp.
   */
  private assertTreeRules(
    candidate: Pick<PositionModel, 'level' | 'reportsToPositionId'>,
    selfId: string | null,
    all: PositionModel[],
  ): void {
    if (!Number.isInteger(candidate.level) || candidate.level < MIN_LEVEL || candidate.level > MAX_LEVEL) {
      throw new BadRequestException(`Cấp phải là số nguyên từ ${MIN_LEVEL} đến ${MAX_LEVEL}`);
    }
    if (candidate.level === MIN_LEVEL) {
      if (candidate.reportsToPositionId) throw new BadRequestException('Vị trí cấp 1 không có cấp trên');
    } else {
      if (!candidate.reportsToPositionId) throw new BadRequestException('Vị trí từ cấp 2 trở lên phải có cấp trên');
      if (candidate.reportsToPositionId === selfId) throw new BadRequestException('Vị trí không thể báo cáo cho chính nó');
      const parent = all.find((p) => p.id === candidate.reportsToPositionId);
      if (!parent) throw new NotFoundException(`Không tìm thấy vị trí cấp trên: ${candidate.reportsToPositionId}`);
      if (parent.level >= candidate.level) {
        throw new BadRequestException(`Cấp trên (cấp ${parent.level}) phải có số cấp nhỏ hơn vị trí này (cấp ${candidate.level})`);
      }
    }
    if (selfId) {
      const tooHigh = all.filter((p) => p.reportsToPositionId === selfId && p.level <= candidate.level);
      if (tooHigh.length > 0) {
        throw new BadRequestException(`Đổi như vậy làm cấp dưới ${tooHigh[0].code} không còn thấp cấp hơn vị trí này`);
      }
    }
  }
}

function groupByParent(all: PositionModel[]): Map<string, PositionModel[]> {
  const map = new Map<string, PositionModel[]>();
  for (const p of all) {
    if (!p.reportsToPositionId) continue;
    const list = map.get(p.reportsToPositionId) ?? [];
    list.push(p);
    map.set(p.reportsToPositionId, list);
  }
  return map;
}

function pick(position: PositionModel, patch: PositionPatch): Record<string, unknown> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, position[k as keyof PositionModel]]));
}
