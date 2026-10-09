import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../../security/index.js';
import type { NewUnit, UnitModel, UnitPatch } from './unit.model.js';
import { UnitRepository } from './unit.repository.js';
import { UnitService } from './unit.service.js';

class InMemoryUnitRepository extends UnitRepository {
  private rows: UnitModel[] = [];

  async findAll() {
    return [...this.rows];
  }
  async findById(id: string) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async findByCode(code: string) {
    return this.rows.find((u) => u.code === code) ?? null;
  }
  async create(data: NewUnit) {
    const row = { ...data, id: `id-${this.rows.length + 1}` };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: UnitPatch) {
    const row = this.rows.find((u) => u.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  async delete(id: string): Promise<'OK' | 'IN_USE'> {
    this.rows = this.rows.filter((u) => u.id !== id);
    return 'OK';
  }
}

describe('UnitService', () => {
  let service: UnitService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UnitService,
        { provide: UnitRepository, useClass: InMemoryUnitRepository },
        { provide: AuditService, useValue: { record: async () => undefined } },
      ],
    }).compile();
    service = moduleRef.get(UnitService);
  });

  it('tạo đơn vị và liệt kê được', async () => {
    const ban = await service.create({ code: 'BTCTU', name: 'Ban Tổ chức Tỉnh ủy', type: 'BAN', parentId: null });
    await service.create({ code: 'TCCB', name: 'Phòng Tổ chức cán bộ', type: 'PHONG', parentId: ban.id });
    expect(await service.list()).toHaveLength(2);
  });

  it('từ chối mã đơn vị trùng', async () => {
    const data = { code: 'TCCB', name: 'Phòng Tổ chức cán bộ', type: 'PHONG' as const, parentId: null };
    await service.create(data);
    await expect(service.create(data)).rejects.toBeInstanceOf(ConflictException);
  });

  it('từ chối đơn vị cha không tồn tại', async () => {
    await expect(
      service.create({ code: 'VP', name: 'Văn phòng Ban', type: 'PHONG', parentId: 'khong-co' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sửa tên, loại, đơn vị cha; mã không đổi', async () => {
    const ban = await service.create({ code: 'BTCTU', name: 'Ban', type: 'BAN', parentId: null });
    const phong = await service.create({ code: 'TCCB', name: 'Phòng cũ', type: 'PHONG', parentId: null });
    const updated = await service.update(phong.id, { name: '  Phòng Tổ chức cán bộ  ', parentId: ban.id });
    expect(updated).toMatchObject({ code: 'TCCB', name: 'Phòng Tổ chức cán bộ', parentId: ban.id });
    await expect(service.update(phong.id, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('khong-co', { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không cho đơn vị làm cha của chính nó hoặc của đơn vị con cháu', async () => {
    const a = await service.create({ code: 'A', name: 'Ban A', type: 'BAN', parentId: null });
    const b = await service.create({ code: 'B', name: 'Phòng B', type: 'PHONG', parentId: a.id });
    const c = await service.create({ code: 'C', name: 'Phòng C', type: 'PHONG', parentId: b.id });
    await expect(service.update(a.id, { parentId: a.id })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(a.id, { parentId: c.id })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update(c.id, { parentId: 'khong-co' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('xóa đơn vị chưa có đơn vị con; còn đơn vị con thì từ chối', async () => {
    const a = await service.create({ code: 'A', name: 'Ban A', type: 'BAN', parentId: null });
    const b = await service.create({ code: 'B', name: 'Phòng B', type: 'PHONG', parentId: a.id });
    await expect(service.delete(a.id)).rejects.toBeInstanceOf(ConflictException);
    await service.delete(b.id);
    await service.delete(a.id);
    expect(await service.list()).toHaveLength(0);
    await expect(service.delete(a.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
