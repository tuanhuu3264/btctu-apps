import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { PositionRepository } from './org.ports.js';
import type { NewUnit, UnitModel, UnitPatch } from './unit.model.js';
import { UnitRepository } from './unit.repository.js';

@Injectable()
export class UnitService {
  constructor(
    private readonly units: UnitRepository,
    private readonly positions: PositionRepository,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Mọi đơn vị, kể cả đã ngừng (báo cáo kỳ cũ vẫn cần tên đơn vị). */
  list(): Promise<UnitModel[]> {
    return this.units.findAll();
  }

  /** Chỉ đơn vị đang hoạt động: dùng cho cây tổ chức và danh sách chọn. */
  async listActive(): Promise<UnitModel[]> {
    return (await this.units.findAll()).filter((u) => u.status === 'ACTIVE');
  }

  async get(id: string): Promise<UnitModel> {
    const unit = await this.units.findById(id);
    if (!unit) throw new NotFoundException(`Không tìm thấy đơn vị: ${id}`);
    return unit;
  }

  findByCode(code: string): Promise<UnitModel | null> {
    return this.units.findByCode(code);
  }

  async create(input: NewUnit): Promise<UnitModel> {
    if (await this.units.findByCode(input.code)) {
      throw new ConflictException(`Mã đơn vị đã tồn tại: ${input.code}`);
    }
    if (input.parentId) {
      const parent = await this.units.findById(input.parentId);
      if (!parent) throw new NotFoundException(`Không tìm thấy đơn vị cha: ${input.parentId}`);
      if (parent.status !== 'ACTIVE') throw new ConflictException('Đơn vị cha đã ngừng sử dụng');
    }
    const created = await this.units.create(input);
    await this.audit.record({
      action: 'unit.create',
      outcome: 'SUCCESS',
      targetType: 'unit',
      targetId: created.id,
      details: { code: created.code, name: created.name, type: created.type, parentId: created.parentId },
    });
    return created;
  }

  /** Sửa tên, loại, đơn vị cha. Mã không đổi. Đơn vị cha không được là chính nó hay đơn vị con cháu của nó. */
  async update(id: string, patch: UnitPatch): Promise<UnitModel> {
    const current = await this.get(id);
    if (patch.name !== undefined && !patch.name.trim()) throw new BadRequestException('Tên đơn vị không được để trống');
    if (patch.parentId) {
      const all = await this.units.findAll();
      const parent = all.find((u) => u.id === patch.parentId);
      if (!parent) throw new NotFoundException(`Không tìm thấy đơn vị cha: ${patch.parentId}`);
      if (parent.status !== 'ACTIVE' && parent.id !== current.parentId) throw new ConflictException('Đơn vị cha đã ngừng sử dụng');
      for (let p: UnitModel | undefined = parent; p; p = p.parentId ? all.find((u) => u.id === p!.parentId) : undefined) {
        if (p.id === id) throw new BadRequestException('Đơn vị cha không được là chính nó hoặc đơn vị con của nó');
      }
    }
    const updated = await this.units.update(id, patch.name === undefined ? patch : { ...patch, name: patch.name.trim() });
    await this.audit.record({
      action: 'unit.update',
      outcome: 'SUCCESS',
      targetType: 'unit',
      targetId: id,
      details: { code: current.code, changed: Object.keys(patch), before: pickOf(current, patch), after: pickOf(updated, patch) },
    });
    return updated;
  }

  /**
   * "Xóa" đơn vị = chuyển sang INACTIVE (dữ liệu lịch sử được giữ). Chỉ ngừng được khi không còn
   * đơn vị con đang hoạt động và không còn vị trí việc làm đang hoạt động.
   */
  async deactivate(id: string, reason?: string): Promise<UnitModel> {
    const unit = await this.get(id);
    if (unit.status === 'INACTIVE') throw new ConflictException('Đơn vị đã ngừng sử dụng');
    const children = (await this.units.findAll()).filter((u) => u.parentId === id && u.status === 'ACTIVE');
    if (children.length > 0) {
      throw new ConflictException(`Đơn vị còn đơn vị con đang hoạt động (${children.map((c) => c.code).join(', ')}) nên chưa ngừng được`);
    }
    const positions = (await this.positions.findAll({ unitId: id })).filter((p) => p.status === 'ACTIVE');
    if (positions.length > 0) {
      throw new ConflictException(`Đơn vị còn vị trí việc làm đang hoạt động (${positions.length}) nên chưa ngừng được; hãy ngừng các vị trí trước`);
    }
    const note = reason?.trim() || null;
    const updated = await this.units.setStatus(id, { status: 'INACTIVE', inactiveAt: this.clock.now(), inactiveReason: note });
    await this.audit.record({
      action: 'unit.deactivate',
      outcome: 'SUCCESS',
      targetType: 'unit',
      targetId: id,
      details: { code: unit.code, name: unit.name, reason: note },
    });
    return updated;
  }

  /** Kích hoạt lại đơn vị đã ngừng; đơn vị cha (nếu có) phải đang hoạt động. */
  async reactivate(id: string): Promise<UnitModel> {
    const unit = await this.get(id);
    if (unit.status === 'ACTIVE') throw new ConflictException('Đơn vị đang hoạt động');
    if (unit.parentId) {
      const parent = await this.units.findById(unit.parentId);
      if (parent && parent.status !== 'ACTIVE') throw new ConflictException('Đơn vị cha đã ngừng sử dụng; hãy kích hoạt đơn vị cha trước');
    }
    const updated = await this.units.setStatus(id, { status: 'ACTIVE', inactiveAt: null, inactiveReason: null });
    await this.audit.record({
      action: 'unit.reactivate',
      outcome: 'SUCCESS',
      targetType: 'unit',
      targetId: id,
      details: { code: unit.code, name: unit.name },
    });
    return updated;
  }
}

function pickOf(unit: UnitModel, patch: UnitPatch): Record<string, unknown> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, unit[k as keyof UnitModel]]));
}
