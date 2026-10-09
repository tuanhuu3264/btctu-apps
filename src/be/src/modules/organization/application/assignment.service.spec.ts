import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { buildOrg, seedChain } from './testing/in-memory.js';
import type { Org } from './testing/in-memory.js';

describe('phân công cán bộ vào vị trí', () => {
  let org: Org;
  let chain: Awaited<ReturnType<typeof seedChain>>;

  beforeEach(async () => {
    org = await buildOrg();
    chain = await seedChain(org);
  });

  const person = (fullName: string) => org.persons.create({ fullName, note: null });

  it('phân công thành công và sơ đồ hiển thị người đang giữ', async () => {
    const a = await person('Nguyễn Văn A');
    await org.assignments.assign(chain.l3.id, a.id);

    const tree = await org.query.tree();
    const holder = tree[0].positions.find((p) => p.id === chain.l3.id)?.holder;
    expect(holder).toEqual({ personId: a.id, fullName: 'Nguyễn Văn A' });
    expect(tree[0].positions.find((p) => p.id === chain.l2.id)?.holder).toBeNull();
  });

  it('một người không giữ hai vị trí cùng lúc; một vị trí không có hai người', async () => {
    const a = await person('Nguyễn Văn A');
    const b = await person('Trần Thị B');
    await org.assignments.assign(chain.l3.id, a.id);

    await expect(org.assignments.assign(chain.l4.id, a.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(org.assignments.assign(chain.l3.id, b.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('chuyển công tác: kết thúc phân công cũ rồi nhận vị trí mới, lịch sử được giữ', async () => {
    const a = await person('Nguyễn Văn A');
    const first = await org.assignments.assign(chain.l4.id, a.id);
    org.clock.advanceDays(30);
    await org.assignments.end(first.id);
    const second = await org.assignments.assign(chain.l3.id, a.id);

    const history = await org.persons.history(a.id);
    expect(history.map((h) => h.positionId)).toEqual([chain.l4.id, chain.l3.id]);
    expect(history[0].validTo).not.toBeNull();
    expect(second.validTo).toBeNull();
    // Vị trí cũ trống và có thể giao cho người khác.
    const b = await person('Trần Thị B');
    await expect(org.assignments.assign(chain.l4.id, b.id)).resolves.toBeDefined();
  });

  it('phân công có ngày bắt đầu trong quá khứ bị từ chối nếu chồng lấn phân công đang mở', async () => {
    const a = await person('Nguyễn Văn A');
    const b = await person('Trần Thị B');
    await org.assignments.assign(chain.l3.id, a.id, new Date('2026-01-01T00:00:00Z'));
    await expect(org.assignments.assign(chain.l3.id, b.id, new Date('2025-06-01T00:00:00Z'))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('không kết thúc hai lần; thời điểm kết thúc phải sau thời điểm bắt đầu; phân công không tồn tại', async () => {
    const a = await person('Nguyễn Văn A');
    const asg = await org.assignments.assign(chain.l3.id, a.id);

    await expect(org.assignments.end(asg.id, new Date('2020-01-01T00:00:00Z'))).rejects.toBeInstanceOf(BadRequestException);
    org.clock.advanceDays(1);
    await org.assignments.end(asg.id);
    await expect(org.assignments.end(asg.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(org.assignments.end('khong-co')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không phân công cán bộ đã ngừng quản lý, cán bộ hay vị trí không tồn tại', async () => {
    const a = await person('Nguyễn Văn A');
    await org.persons.deactivate(a.id);
    await expect(org.assignments.assign(chain.l3.id, a.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(org.assignments.assign(chain.l3.id, 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
    const b = await person('Trần Thị B');
    await expect(org.assignments.assign('khong-co', b.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('chỉ ngừng quản lý cán bộ sau khi đã kết thúc phân công', async () => {
    const a = await person('Nguyễn Văn A');
    const asg = await org.assignments.assign(chain.l3.id, a.id);
    await expect(org.persons.deactivate(a.id)).rejects.toBeInstanceOf(ConflictException);

    org.clock.advanceDays(1);
    await org.assignments.end(asg.id);
    await org.persons.deactivate(a.id);
    expect((await org.persons.get(a.id)).active).toBe(false);
    await org.persons.deactivate(a.id); // lặp lại không lỗi
  });

  it('sơ đồ không hiển thị người đã hết thời gian giữ vị trí', async () => {
    const a = await person('Nguyễn Văn A');
    const asg = await org.assignments.assign(chain.l3.id, a.id);
    org.clock.advanceDays(1);
    await org.assignments.end(asg.id);
    org.clock.advanceDays(1);

    const tree = await org.query.tree();
    expect(tree[0].positions.find((p) => p.id === chain.l3.id)?.holder).toBeNull();
  });

  it('chuẩn hóa họ tên và từ chối họ tên quá ngắn', async () => {
    expect((await person('  Nguyễn   Văn   A ')).fullName).toBe('Nguyễn Văn A');
    await expect(person('A')).rejects.toBeInstanceOf(BadRequestException);
    const created = await person('Trần Thị B');
    await expect(org.persons.update(created.id, { fullName: ' ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('gắn và gỡ tài khoản qua dịch vụ security; không gắn cho cán bộ đã ngừng quản lý', async () => {
    const a = await person('Nguyễn Văn A');
    await org.persons.linkAccount(a.id, 'acc-1');
    expect(org.accounts.links.get('acc-1')).toBe(a.id);
    await org.persons.unlinkAccount(a.id);
    expect(org.accounts.links.size).toBe(0);

    await org.persons.deactivate(a.id);
    await expect(org.persons.linkAccount(a.id, 'acc-2')).rejects.toBeInstanceOf(ConflictException);
    await expect(org.persons.linkAccount('khong-co', 'acc-2')).rejects.toBeInstanceOf(NotFoundException);
  });
});
