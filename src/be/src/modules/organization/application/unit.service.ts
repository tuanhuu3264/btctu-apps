import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../security/index.js';
import type { NewUnit, UnitModel, UnitPatch } from './unit.model.js';
import { UnitRepository } from './unit.repository.js';

@Injectable()
export class UnitService {
  constructor(
    private readonly units: UnitRepository,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<UnitModel[]> {
    return this.units.findAll();
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
    if (input.parentId && !(await this.units.findById(input.parentId))) {
      throw new NotFoundException(`Không tìm thấy đơn vị cha: ${input.parentId}`);
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

  /** Xóa đơn vị chưa có đơn vị con, vị trí hay phạm vi công việc nào. */
  async delete(id: string): Promise<void> {
    const unit = await this.get(id);
    if ((await this.units.findAll()).some((u) => u.parentId === id)) {
      throw new ConflictException('Đơn vị còn đơn vị con nên chưa xóa được');
    }
    if ((await this.units.delete(id)) === 'IN_USE') {
      throw new ConflictException('Đơn vị còn vị trí việc làm hoặc đang được gán phạm vi công việc nên chưa xóa được');
    }
    await this.audit.record({
      action: 'unit.delete',
      outcome: 'SUCCESS',
      targetType: 'unit',
      targetId: id,
      details: { code: unit.code, name: unit.name },
    });
  }
}

function pickOf(unit: UnitModel, patch: UnitPatch): Record<string, unknown> {
  return Object.fromEntries(Object.keys(patch).map((k) => [k, unit[k as keyof UnitModel]]));
}
