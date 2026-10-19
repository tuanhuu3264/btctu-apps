import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { PositionRepository } from './org.ports.js';
import type { InactiveInfo, NewUnit, UnitModel, UnitPatch } from './unit.model.js';
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
    const row: UnitModel = { ...data, status: 'ACTIVE', inactiveAt: null, inactiveReason: null, id: `id-${this.rows.length + 1}` };
    this.rows.push(row);
    return row;
  }
  async update(id: string, patch: UnitPatch) {
    const row = this.rows.find((u) => u.id === id)!;
    Object.assign(row, patch);
    return row;
  }
  async setStatus(id: string, info: InactiveInfo) {
    const row = this.rows.find((u) => u.id === id)!;
    Object.assign(row, info);
    return row;
  }
}

describe('UnitService', () => {
  let service: UnitService;
  const positionsStub = { findAll: async (): Promise<{ status: string }[]> => activePositions };
  let activePositions: { status: string }[] = [];

  beforeEach(async () => {
    activePositions = [];
    const moduleRef = await Test.createTestingModule({
      providers: [
        UnitService,
        { provide: UnitRepository, useClass: InMemoryUnitRepository },
        { provide: PositionRepository, useValue: positionsStub },
        { provide: Clock, useValue: { now: () => new Date('2026-10-16T00:00:00Z') } },
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

  it('ngừng đơn vị (xóa mềm): còn đơn vị con hoạt động thì từ chối; giữ dòng dữ liệu; kích hoạt lại được', async () => {
    const a = await service.create({ code: 'A', name: 'Ban A', type: 'BAN', parentId: null });
    const b = await service.create({ code: 'B', name: 'Phòng B', type: 'PHONG', parentId: a.id });
    await expect(service.deactivate(a.id)).rejects.toBeInstanceOf(ConflictException);
    const off = await service.deactivate(b.id, ' Sáp nhập ');
    expect(off).toMatchObject({ status: 'INACTIVE', inactiveReason: 'Sáp nhập' });
    expect(off.inactiveAt).toBeInstanceOf(Date);
    await service.deactivate(a.id);
    expect(await service.list()).toHaveLength(2); // vẫn còn dòng
    expect(await service.listActive()).toHaveLength(0);
    await expect(service.deactivate(a.id)).rejects.toBeInstanceOf(ConflictException); // đã ngừng
    await expect(service.deactivate('khong-co')).rejects.toBeInstanceOf(NotFoundException);

    await expect(service.reactivate(b.id)).rejects.toBeInstanceOf(ConflictException); // cha còn ngừng
    await service.reactivate(a.id);
    expect(await service.reactivate(b.id)).toMatchObject({ status: 'ACTIVE', inactiveAt: null, inactiveReason: null });
    await expect(service.reactivate(b.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('không ngừng đơn vị còn vị trí đang hoạt động; không tạo đơn vị con dưới đơn vị đã ngừng', async () => {
    const a = await service.create({ code: 'A', name: 'Ban A', type: 'BAN', parentId: null });
    activePositions = [{ status: 'ACTIVE' }];
    await expect(service.deactivate(a.id)).rejects.toBeInstanceOf(ConflictException);
    activePositions = [];
    await service.deactivate(a.id);
    await expect(service.create({ code: 'C', name: 'Phòng C', type: 'PHONG', parentId: a.id })).rejects.toBeInstanceOf(ConflictException);
  });
});
