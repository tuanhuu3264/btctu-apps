import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { buildOrg, seedChain } from './testing/in-memory.js';
import type { Org } from './testing/in-memory.js';

describe('PositionService: bất biến của cây vị trí', () => {
  let org: Org;
  beforeEach(async () => {
    org = await buildOrg();
  });

  const base = (unitId: string) => ({ unitId, duties: null, referenceOkr: null });

  it('cấp 1 không có cấp trên; cấp từ 2 trở lên bắt buộc có cấp trên', async () => {
    const { ban, l1 } = await seedChain(org);
    await expect(
      org.positions.create({ ...base(ban.id), code: 'X-ROOT', title: 'x', level: 1, reportsToPositionId: l1.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      org.positions.create({ ...base(ban.id), code: 'X-ORPHAN', title: 'x', level: 3, reportsToPositionId: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cấp trên phải có số cấp nhỏ hơn (loại được vòng lặp)', async () => {
    const { ban, l3 } = await seedChain(org);
    for (const level of [2, 3]) {
      await expect(
        org.positions.create({ ...base(ban.id), code: `X-BAD-${level}`, title: 'x', level, reportsToPositionId: l3.id }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(
      org.positions.create({ ...base(ban.id), code: 'X-OK', title: 'x', level: 4, reportsToPositionId: l3.id }),
    ).resolves.toBeDefined();
  });

  it('từ chối mã sai định dạng, mã trùng, đơn vị hoặc cấp trên không tồn tại, cấp ngoài khoảng', async () => {
    const { ban, l1 } = await seedChain(org);
    const ok = { ...base(ban.id), title: 'x', level: 2, reportsToPositionId: l1.id };
    await expect(org.positions.create({ ...ok, code: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(org.positions.create({ ...ok, code: 'BTCTU-L1-A' })).rejects.toBeInstanceOf(ConflictException);
    await expect(org.positions.create({ ...ok, code: 'X-NOUNIT', unitId: 'khong-co' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(org.positions.create({ ...ok, code: 'X-NOPARENT', reportsToPositionId: 'khong-co' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(org.positions.create({ ...ok, code: 'X-LV6', level: 6 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(org.positions.create({ ...ok, code: 'X-LV0', level: 0, reportsToPositionId: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('cập nhật', () => {
    it('đổi tên và nhiệm vụ không ảnh hưởng cây; ghi nhật ký trước/sau', async () => {
      const { l3 } = await seedChain(org);
      const updated = await org.positions.update(l3.id, { title: 'Trưởng phòng', duties: 'Phụ trách chung' });
      expect(updated).toMatchObject({ title: 'Trưởng phòng', duties: 'Phụ trách chung', level: 3 });
      const entry = org.audit.find((a) => a.action === 'position.update');
      expect(entry?.details).toMatchObject({ changed: ['title', 'duties'] });
    });

    it('không cho đổi cấp làm cấp dưới không còn thấp cấp hơn', async () => {
      const { l2, l3 } = await seedChain(org); // l3 (cấp 3) có cấp dưới trực tiếp l4 (cấp 4)
      await expect(org.positions.update(l3.id, { level: 4 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(org.positions.update(l3.id, { level: 5 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(org.positions.update(l2.id, { level: 3 })).rejects.toBeInstanceOf(BadRequestException); // cấp 3 không nhỏ hơn cấp 3 của l3
      await expect(org.positions.update(l3.id, { level: 3, title: 'giữ nguyên cấp' })).resolves.toBeDefined();
    });

    it('không cho đổi cấp trên sang vị trí cùng hoặc thấp hơn cấp, hoặc chính nó', async () => {
      const { l3, l4, l5 } = await seedChain(org);
      await expect(org.positions.update(l4.id, { reportsToPositionId: l5.id })).rejects.toBeInstanceOf(BadRequestException);
      await expect(org.positions.update(l4.id, { reportsToPositionId: l4.id })).rejects.toBeInstanceOf(BadRequestException);
      await expect(org.positions.update(l5.id, { reportsToPositionId: l3.id })).resolves.toBeDefined();
    });

    it('đưa vị trí lên cấp 1 thì phải bỏ cấp trên; cho phép nhiều vị trí cấp 1', async () => {
      const { l2 } = await seedChain(org);
      await expect(org.positions.update(l2.id, { level: 1 })).rejects.toBeInstanceOf(BadRequestException); // vẫn còn cấp trên
      const promoted = await org.positions.update(l2.id, { level: 1, reportsToPositionId: null });
      expect(promoted).toMatchObject({ level: 1, reportsToPositionId: null });
    });

    it('báo không tìm thấy khi cập nhật vị trí không tồn tại', async () => {
      await expect(org.positions.update('khong-co', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('truy vấn cây', () => {
    it('cấp dưới: trực tiếp hoặc toàn bộ', async () => {
      const { l1, l2, l3, l4, l5 } = await seedChain(org);
      expect((await org.positions.subordinates(l1.id, { direct: true })).map((p) => p.id)).toEqual([l2.id]);
      expect((await org.positions.subordinates(l1.id, { direct: false })).map((p) => p.id)).toEqual([l2.id, l3.id, l4.id, l5.id]);
      expect(await org.positions.subordinates(l5.id, { direct: false })).toEqual([]);
    });

    it('chuỗi cấp trên đi từ gần đến xa và dừng ở gốc', async () => {
      const { l1, l2, l3, l5 } = await seedChain(org);
      expect((await org.positions.chain(l5.id)).map((p) => p.level)).toEqual([4, 3, 2, 1]);
      expect(await org.positions.chain(l1.id)).toEqual([]);
      expect((await org.positions.chain(l3.id)).map((p) => p.id)).toEqual([l2.id, l1.id]);
    });

    it('báo không tìm thấy với vị trí không tồn tại', async () => {
      await expect(org.positions.subordinates('khong-co', { direct: true })).rejects.toBeInstanceOf(NotFoundException);
      await expect(org.positions.chain('khong-co')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('PositionService: cờ lãnh đạo, quản lý và xóa vị trí (ADR-022)', () => {
  let org: Org;
  beforeEach(async () => {
    org = await buildOrg();
  });

  it('không nêu cờ thì lấy theo cấp: cấp 1 đến 4 là lãnh đạo, cấp 5 thì không; sửa cờ độc lập với cấp', async () => {
    const { l1, l2, l3, l4, l5 } = await seedChain(org);
    expect([l1, l2, l3, l4, l5].map((p) => p.isLeader)).toEqual([true, true, true, true, false]);

    const off = await org.positions.update(l3.id, { isLeader: false });
    expect(off).toMatchObject({ level: 3, isLeader: false });
    const on = await org.positions.update(l5.id, { isLeader: true });
    expect(on).toMatchObject({ level: 5, isLeader: true });
    expect(org.audit.at(-1)).toMatchObject({ action: 'position.update' });
  });

  it('nêu cờ khi tạo thì theo cờ đã nêu', async () => {
    const { ban, l1 } = await seedChain(org);
    const created = await org.positions.create({ unitId: ban.id, code: 'X-LEAD-5', title: 'Chuyên viên phụ trách', level: 5, reportsToPositionId: l1.id, duties: null, referenceOkr: null, isLeader: true });
    expect(created.isLeader).toBe(true);
  });

  it('vị trí hỗ trợ, phục vụ (ADR-053): mặc định không; bật thì không là lãnh đạo; không đồng thời là lãnh đạo', async () => {
    const { ban, l1, l3, l5 } = await seedChain(org);
    expect(l5.isSupport).toBe(false);
    const base = { unitId: ban.id, level: 5, reportsToPositionId: l1.id, duties: null, referenceOkr: null };
    const driver = await org.positions.create({ ...base, code: 'X-LAI-XE', title: 'Lái xe', isSupport: true });
    expect(driver).toMatchObject({ isSupport: true, isLeader: false });
    expect(org.audit.at(-1)?.details).toMatchObject({ isSupport: true });
    await expect(org.positions.create({ ...base, code: 'X-SAI', title: 'Sai', isSupport: true, isLeader: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(org.positions.update(l3.id, { isSupport: true })).rejects.toThrow(/không đồng thời là vị trí lãnh đạo/); // cấp 3 đang là lãnh đạo
    expect(await org.positions.update(l5.id, { isSupport: true })).toMatchObject({ isSupport: true });
    await expect(org.positions.update(l5.id, { isLeader: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ngừng vị trí (xóa mềm): còn cấp dưới hoạt động hoặc còn người giữ thì từ chối; ghi nhật ký; kích hoạt lại được', async () => {
    const { l1, l5 } = await seedChain(org);
    await expect(org.positions.deactivate(l1.id)).rejects.toBeInstanceOf(ConflictException); // còn cấp dưới

    const person = await org.persons.create({ fullName: 'Nguyễn Văn A', note: null });
    const asg = await org.assignments.assign(l5.id, person.id);
    await expect(org.positions.deactivate(l5.id)).rejects.toBeInstanceOf(ConflictException); // còn người giữ
    org.clock.advanceDays(1);
    await org.assignments.end(asg.id);

    const off = await org.positions.deactivate(l5.id, '  Gộp vị trí  ');
    expect(off).toMatchObject({ status: 'INACTIVE', inactiveReason: 'Gộp vị trí' });
    expect(off.inactiveAt).toBeInstanceOf(Date);
    expect(await org.positions.get(l5.id)).toMatchObject({ status: 'INACTIVE' }); // dòng vẫn còn
    expect(org.audit.at(-1)).toMatchObject({ action: 'position.deactivate' });
    await expect(org.positions.deactivate(l5.id)).rejects.toBeInstanceOf(ConflictException); // đã ngừng

    expect((await org.positions.listActive()).map((p) => p.id)).not.toContain(l5.id);
    expect((await org.positions.list()).map((p) => p.id)).toContain(l5.id);
    await expect(org.assignments.assign(l5.id, person.id)).rejects.toBeInstanceOf(ConflictException); // không phân công vào vị trí đã ngừng

    const on = await org.positions.reactivate(l5.id);
    expect(on).toMatchObject({ status: 'ACTIVE', inactiveAt: null, inactiveReason: null });
    expect(org.audit.at(-1)).toMatchObject({ action: 'position.reactivate' });
  });

  it('không kích hoạt lại vị trí khi đơn vị đã ngừng; không tạo vị trí mới dưới đơn vị hay cấp trên đã ngừng', async () => {
    const { ban, l1, l5 } = await seedChain(org);
    await org.positions.deactivate(l5.id);
    const l4 = (await org.positions.list()).find((p) => p.level === 4)!;
    await expect(
      org.positions.create({ unitId: ban.id, code: 'BTCTU-L5-B', title: 'Mới', level: 5, reportsToPositionId: l4.id, duties: null, referenceOkr: null }),
    ).resolves.toBeDefined();
    // ngừng toàn bộ vị trí rồi ngừng đơn vị
    for (const p of [...(await org.positions.list())].sort((a, b) => b.level - a.level)) {
      if (p.status === 'ACTIVE') await org.positions.deactivate(p.id);
    }
    await org.units.deactivate(ban.id);
    await expect(org.positions.reactivate(l5.id)).rejects.toBeInstanceOf(ConflictException); // đơn vị đã ngừng
    await expect(
      org.positions.create({ unitId: ban.id, code: 'BTCTU-L1-B', title: 'Mới', level: 1, reportsToPositionId: null, duties: null, referenceOkr: null }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(l1.id).toBeDefined();
  });
});
