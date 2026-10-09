import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { coefficientOf } from './catalog.model.js';
import { approver, buildCatalog, seedDraft } from './testing/in-memory.js';
import type { Catalog } from './testing/in-memory.js';

describe('coefficientOf', () => {
  it('hệ số = điểm chấm / điểm công việc chuẩn', () => {
    expect(coefficientOf(90, 90)).toBe(1);
    expect(coefficientOf(120, 90)).toBeCloseTo(1.3333, 4);
    expect(coefficientOf(10, 90)).toBeCloseTo(0.1111, 4);
  });

  it('rỗng khi thiếu điểm hoặc chuẩn không hợp lệ', () => {
    expect(coefficientOf(null, 90)).toBeNull();
    expect(coefficientOf(120, null)).toBeNull();
    expect(coefficientOf(120, 0)).toBeNull();
  });
});

describe('CatalogService: phiên bản và công việc', () => {
  let c: Catalog;
  beforeEach(async () => {
    c = await buildCatalog();
  });

  const base = { complexity: 2, durationMode: 'ACTUAL' as const };

  describe('tạo phiên bản', () => {
    it('từ chối nhãn quá ngắn, quá dài hoặc trùng', async () => {
      await expect(c.catalog.createVersion({ label: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.catalog.createVersion({ label: 'x'.repeat(121) })).rejects.toBeInstanceOf(BadRequestException);
      await c.catalog.createVersion({ label: 'Phiên bản 1' });
      await expect(c.catalog.createVersion({ label: ' Phiên bản 1 ' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('sao chép công việc và công việc chuẩn sang bản nháp mới, độc lập với bản gốc', async () => {
      const { version } = await seedDraft(c);
      const copy = await c.catalog.createVersion({ label: 'Bản sao', copyFromVersionId: version.id });

      const view = await c.catalog.getVersion(copy.id);
      expect(view.items.map((i) => i.code).sort()).toEqual(['A.003', 'A.007', 'B.001', 'B.009']);
      expect(view.version.baselineItemCode).toBe('B.009');
      expect(view.version.sourceNote).toMatch(/Sao chép từ/);

      const copied = view.items.find((i) => i.code === 'A.003')!;
      await c.catalog.updateItem(copied.id, { points: 999 });
      const original = (await c.catalog.getVersion(version.id)).items.find((i) => i.code === 'A.003')!;
      expect(original.points).toBe(120);
    });

    it('báo không tìm thấy khi sao chép từ phiên bản không tồn tại', async () => {
      await expect(c.catalog.createVersion({ label: 'Bản sao', copyFromVersionId: 'khong-co' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('thêm và sửa công việc', () => {
    it('kiểm tra mã, trùng mã, độ phức tạp, điểm, thời gian', async () => {
      const v = await c.catalog.createVersion({ label: 'Bản nháp' });
      const ok = { code: 'A.001', name: 'Việc 1', ...base };
      await expect(c.catalog.addItem(v.id, { ...ok, code: 'E.001' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.catalog.addItem(v.id, { ...ok, code: 'A.1' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.catalog.addItem(v.id, { ...ok, complexity: 5 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.catalog.addItem(v.id, { ...ok, complexity: 0 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.catalog.addItem(v.id, { ...ok, points: -1 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.catalog.addItem(v.id, { ...ok, name: '  ' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(c.catalog.addItem(v.id, { ...ok, durationMode: 'LIMITED' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        c.catalog.addItem(v.id, { ...ok, durationMode: 'ACTUAL', durationValue: 3, durationUnit: 'HOUR' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(c.catalog.addItem(v.id, ok)).resolves.toMatchObject({ code: 'A.001', groupCode: 'A', sortOrder: 1 });
      await expect(c.catalog.addItem(v.id, ok)).rejects.toBeInstanceOf(ConflictException);
    });

    it('nhóm suy ra từ chữ cái đầu của mã; thứ tự tăng dần theo lần thêm', async () => {
      const v = await c.catalog.createVersion({ label: 'Bản nháp' });
      const b = await c.catalog.addItem(v.id, { code: 'B.001', name: 'B', ...base });
      const a = await c.catalog.addItem(v.id, { code: 'A.001', name: 'A', ...base });
      expect(b).toMatchObject({ groupCode: 'B', sortOrder: 1 });
      expect(a).toMatchObject({ groupCode: 'A', sortOrder: 2 });
    });

    it('sửa một phần giữ nguyên các trường khác; đổi sang "Thực tế" tự xóa giá trị và đơn vị thời gian', async () => {
      const { items } = await seedDraft(c);
      const updated = await c.catalog.updateItem(items.a3.id, { name: 'Tên mới' });
      expect(updated).toMatchObject({ name: 'Tên mới', points: 120, durationMode: 'LIMITED', durationValue: 4, durationUnit: 'HOUR' });

      const actual = await c.catalog.updateItem(items.a3.id, { durationMode: 'ACTUAL' });
      expect(actual).toMatchObject({ durationMode: 'ACTUAL', durationValue: null, durationUnit: null });
      await expect(c.catalog.updateItem(items.a3.id, { complexity: 9 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('xóa công việc; báo không tìm thấy khi không tồn tại', async () => {
      const { version, items } = await seedDraft(c);
      await c.catalog.deleteItem(items.light.id);
      expect((await c.catalog.getVersion(version.id)).items.map((i) => i.code)).not.toContain('B.001');
      await expect(c.catalog.deleteItem('khong-co')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('công việc chuẩn và hệ số', () => {
    it('hệ số tính khi đọc từ điểm công việc chuẩn; công việc chưa có điểm bị đánh dấu', async () => {
      const { version } = await seedDraft(c);
      const view = await c.catalog.getVersion(version.id);
      const by = Object.fromEntries(view.items.map((i) => [i.code, i]));

      expect(view.baseline).toEqual({ code: 'B.009', points: 90 });
      expect(by['B.009'].coefficient).toBe(1);
      expect(by['A.003'].coefficient).toBeCloseTo(120 / 90, 10);
      expect(by['B.001'].coefficient).toBeCloseTo(5 / 90, 10);
      expect(by['A.007']).toMatchObject({ coefficient: null, needsScoring: true });
      expect(view.warnings).toEqual(['Công việc A.007 chưa có điểm chấm']);
    });

    it('đổi công việc chuẩn thì mọi hệ số đổi theo, không lưu hệ số cũ', async () => {
      const { version } = await seedDraft(c);
      await c.catalog.setBaseline(version.id, 'A.003');
      const view = await c.catalog.getVersion(version.id);
      expect(view.items.find((i) => i.code === 'A.003')!.coefficient).toBe(1);
      expect(view.items.find((i) => i.code === 'B.009')!.coefficient).toBeCloseTo(90 / 120, 10);
    });

    it('công việc chuẩn phải tồn tại và có điểm lớn hơn 0', async () => {
      const { version } = await seedDraft(c);
      await expect(c.catalog.setBaseline(version.id, 'A.007')).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.setBaseline(version.id, 'C.001')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('không xóa công việc chuẩn, không xóa điểm của nó', async () => {
      const { items } = await seedDraft(c);
      await expect(c.catalog.deleteItem(items.baseline.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.updateItem(items.baseline.id, { points: null })).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.updateItem(items.baseline.id, { points: 0 })).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.updateItem(items.baseline.id, { points: 100 })).resolves.toMatchObject({ points: 100 });
    });

    it('chưa có công việc chuẩn thì cảnh báo và không có hệ số', async () => {
      const v = await c.catalog.createVersion({ label: 'Chưa có chuẩn' });
      await c.catalog.addItem(v.id, { code: 'A.001', name: 'x', complexity: 1, durationMode: 'ACTUAL', points: 10 });
      const view = await c.catalog.getVersion(v.id);
      expect(view.baseline).toBeNull();
      expect(view.items[0].coefficient).toBeNull();
      expect(view.warnings[0]).toMatch(/Chưa có công việc chuẩn/);
    });
  });

  describe('phê duyệt', () => {
    it('phê duyệt khóa phiên bản: không thêm, sửa, xóa, đổi chuẩn nữa', async () => {
      const { version, items } = await seedDraft(c);
      const view = await c.catalog.approve(approver, version.id);
      expect(view.version).toMatchObject({ status: 'APPROVED', approvedBy: approver.id });
      expect(view.warnings).toEqual(['Công việc A.007 chưa có điểm chấm']); // không chặn phê duyệt

      await expect(c.catalog.addItem(version.id, { code: 'A.099', name: 'x', complexity: 1, durationMode: 'ACTUAL' })).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.updateItem(items.a3.id, { points: 1 })).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.deleteItem(items.light.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.setBaseline(version.id, 'A.003')).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.approve(approver, version.id)).rejects.toBeInstanceOf(ConflictException);
    });

    it('chỉ phê duyệt khi có công việc, đã chọn chuẩn và chuẩn có điểm', async () => {
      const empty = await c.catalog.createVersion({ label: 'Rỗng' });
      await expect(c.catalog.approve(approver, empty.id)).rejects.toBeInstanceOf(ConflictException);

      const noBaseline = await c.catalog.createVersion({ label: 'Không chuẩn' });
      await c.catalog.addItem(noBaseline.id, { code: 'A.001', name: 'x', complexity: 1, durationMode: 'ACTUAL', points: 10 });
      await expect(c.catalog.approve(approver, noBaseline.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.approve(approver, 'khong-co')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('thời điểm hiệu lực phải sau phiên bản đã phê duyệt trước đó', async () => {
      const first = (await seedDraft(c, 'Bản 1')).version;
      await c.catalog.approve(approver, first.id, new Date('2026-10-10T00:00:00Z'));

      const second = await c.catalog.createVersion({ label: 'Bản 2', copyFromVersionId: first.id });
      await expect(c.catalog.approve(approver, second.id, new Date('2026-10-10T00:00:00Z'))).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.approve(approver, second.id, new Date('2026-09-01T00:00:00Z'))).rejects.toBeInstanceOf(ConflictException);
      await expect(c.catalog.approve(approver, second.id, new Date('2026-11-01T00:00:00Z'))).resolves.toBeDefined();
    });

    it('phiên bản đang có hiệu lực: chưa có thì báo; chuyển sang bản mới khi tới thời điểm hiệu lực', async () => {
      await expect(c.catalog.current()).rejects.toBeInstanceOf(NotFoundException);

      const v1 = (await seedDraft(c, 'Bản 1')).version;
      await c.catalog.approve(approver, v1.id); // hiệu lực ngay
      expect((await c.catalog.current()).version.label).toBe('Bản 1');

      const v2 = await c.catalog.createVersion({ label: 'Bản 2', copyFromVersionId: v1.id });
      c.clock.advanceDays(1);
      await c.catalog.approve(approver, v2.id, new Date(c.clock.now().getTime() + 5 * 86_400_000));
      expect((await c.catalog.current()).version.label).toBe('Bản 1'); // bản 2 chưa tới hiệu lực

      c.clock.advanceDays(6);
      expect((await c.catalog.current()).version.label).toBe('Bản 2');
    });

    it('bản nháp chưa phê duyệt không bao giờ là bản đang có hiệu lực', async () => {
      await seedDraft(c);
      await expect(c.catalog.current()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('ghi nhật ký cho mọi thay đổi', async () => {
    const { version, items } = await seedDraft(c);
    await c.catalog.updateItem(items.a3.id, { points: 130 });
    await c.catalog.deleteItem(items.light.id);
    await c.catalog.approve(approver, version.id);
    const actions = c.audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      'catalog.version.create',
      'catalog.item.create',
      'catalog.baseline.set',
      'catalog.item.update',
      'catalog.item.delete',
      'catalog.version.approve',
    ]));
    expect(c.audit.find((a) => a.action === 'catalog.item.update')?.details).toMatchObject({
      changed: ['points'],
      before: { points: 120 },
      after: { points: 130 },
    });
  });
});

describe('CatalogService: nhiệm vụ của danh mục (ADR-019)', () => {
  let c: Catalog;
  beforeEach(async () => {
    c = await buildCatalog();
  });

  it('tạo nhiệm vụ trong nhóm, chuẩn hóa tên, không trùng trong cùng nhóm (không phân biệt hoa thường)', async () => {
    const version = await c.catalog.createVersion({ label: 'Nháp nhiệm vụ' });
    const task = await c.catalog.createTask(version.id, { groupCode: 'C', name: '  Công tác   quy hoạch  ', description: ' Mô tả ' });
    expect(task).toMatchObject({ versionId: version.id, groupCode: 'C', name: 'Công tác quy hoạch', description: 'Mô tả' });

    await expect(c.catalog.createTask(version.id, { groupCode: 'C', name: 'CÔNG TÁC quy hoạch' })).rejects.toBeInstanceOf(ConflictException);
    await expect(c.catalog.createTask(version.id, { groupCode: 'B', name: 'Công tác quy hoạch' })).resolves.toBeTruthy(); // nhóm khác dùng lại tên
    await expect(c.catalog.createTask(version.id, { groupCode: 'C', name: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.createTask(version.id, { groupCode: 'E', name: 'Nhóm không có' })).rejects.toBeInstanceOf(BadRequestException);
    expect(c.audit.filter((a) => a.action === 'catalog.task.create')).toHaveLength(2);
  });

  it('thêm công việc vào nhiệm vụ: mã tự sinh theo nhóm của nhiệm vụ, tính từ mã lớn nhất đang có', async () => {
    const { version } = await seedDraft(c); // A.003, A.007, B.001, B.009
    const taskA = await c.catalog.createTask(version.id, { groupCode: 'A', name: 'Thẩm định văn bản' });
    const taskB = await c.catalog.createTask(version.id, { groupCode: 'B', name: 'Hành chính' });
    const body = { name: 'Việc mới', complexity: 2, durationMode: 'ACTUAL' as const };

    const a = await c.catalog.addItem(version.id, { ...body, taskId: taskA.id });
    const b = await c.catalog.addItem(version.id, { ...body, taskId: taskB.id });
    const a2 = await c.catalog.addItem(version.id, { ...body, taskId: taskA.id });
    expect([a.code, b.code, a2.code]).toEqual(['A.008', 'B.010', 'A.009']);
    expect(a).toMatchObject({ taskId: taskA.id, groupCode: 'A' });
  });

  it('nhóm chưa có công việc nào thì mã tự sinh bắt đầu từ 001', async () => {
    const version = await c.catalog.createVersion({ label: 'Nháp rỗng' });
    const task = await c.catalog.createTask(version.id, { groupCode: 'D', name: 'Việc khác' });
    const item = await c.catalog.addItem(version.id, { name: 'Việc đầu', complexity: 1, durationMode: 'UNSPECIFIED', taskId: task.id });
    expect(item.code).toBe('D.001');
  });

  it('từ chối mã khác nhóm với nhiệm vụ, nhiệm vụ của phiên bản khác, hoặc thiếu cả mã lẫn nhiệm vụ', async () => {
    const v1 = await c.catalog.createVersion({ label: 'Nháp 1' });
    const v2 = await c.catalog.createVersion({ label: 'Nháp 2' });
    const taskA = await c.catalog.createTask(v1.id, { groupCode: 'A', name: 'Nhiệm vụ A' });
    const body = { name: 'Việc', complexity: 2, durationMode: 'ACTUAL' as const };

    await expect(c.catalog.addItem(v1.id, { ...body, taskId: taskA.id, code: 'B.001' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.addItem(v2.id, { ...body, taskId: taskA.id })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.addItem(v1.id, { ...body })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.addItem(v1.id, { ...body, taskId: 'khong-co' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.catalog.addItem(v1.id, { ...body, taskId: taskA.id, code: 'A.001' })).resolves.toMatchObject({ code: 'A.001' }); // nhập tay mã đúng nhóm vẫn được
  });

  it('thêm công việc chỉ có mã (không nhiệm vụ) thì vào nhiệm vụ mặc định của nhóm, tạo một lần', async () => {
    const { version } = await seedDraft(c);
    const view = await c.catalog.getVersion(version.id);
    const defaults = view.tasks.filter((t) => t.name === 'Chưa phân nhiệm vụ');
    expect(defaults.map((t) => t.groupCode).sort()).toEqual(['A', 'B']);
    expect(defaults.find((t) => t.groupCode === 'A')!.itemCount).toBe(2); // A.003, A.007
    expect(defaults.find((t) => t.groupCode === 'B')!.itemCount).toBe(2); // B.001, B.009
    expect(view.items.every((i) => view.tasks.some((t) => t.id === i.taskId && t.groupCode === i.groupCode))).toBe(true);
  });

  it('chuyển công việc sang nhiệm vụ khác chỉ khi cùng nhóm', async () => {
    const { version, items } = await seedDraft(c);
    const sameGroup = await c.catalog.createTask(version.id, { groupCode: 'A', name: 'Thẩm định' });
    const otherGroup = await c.catalog.createTask(version.id, { groupCode: 'B', name: 'Hành chính' });

    expect((await c.catalog.updateItem(items.a3.id, { taskId: sameGroup.id })).taskId).toBe(sameGroup.id);
    await expect(c.catalog.updateItem(items.a3.id, { taskId: otherGroup.id })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.updateItem(items.a3.id, { taskId: 'khong-co' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sửa tên nhiệm vụ, không trùng tên trong nhóm; chỉ xóa nhiệm vụ rỗng', async () => {
    const { version, items } = await seedDraft(c);
    const t1 = await c.catalog.createTask(version.id, { groupCode: 'A', name: 'Nhiệm vụ một' });
    const t2 = await c.catalog.createTask(version.id, { groupCode: 'A', name: 'Nhiệm vụ hai' });
    expect(await c.catalog.updateTask(t1.id, { name: ' Nhiệm vụ  1 ', description: ' mô tả ' })).toMatchObject({ name: 'Nhiệm vụ 1', description: 'mô tả' });
    await expect(c.catalog.updateTask(t2.id, { name: 'nhiệm vụ 1' })).rejects.toBeInstanceOf(ConflictException);
    await expect(c.catalog.updateTask(t2.id, { name: 'x' })).rejects.toBeInstanceOf(BadRequestException);

    await c.catalog.updateItem(items.a3.id, { taskId: t1.id });
    await expect(c.catalog.deleteTask(t1.id)).rejects.toBeInstanceOf(ConflictException); // còn công việc
    await c.catalog.deleteTask(t2.id);
    expect((await c.catalog.getVersion(version.id)).tasks.some((t) => t.id === t2.id)).toBe(false);
    await expect(c.catalog.deleteTask(t2.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bản nháp sao chép có đủ nhiệm vụ, công việc vẫn thuộc đúng nhiệm vụ (của phiên bản mới)', async () => {
    const { version, items } = await seedDraft(c);
    const task = await c.catalog.createTask(version.id, { groupCode: 'A', name: 'Thẩm định văn bản' });
    await c.catalog.updateItem(items.a3.id, { taskId: task.id });
    await c.catalog.approve(approver, version.id);

    const copy = await c.catalog.createVersion({ label: 'Bản sao', copyFromVersionId: version.id });
    const view = await c.catalog.getVersion(copy.id);
    const copiedTask = view.tasks.find((t) => t.name === 'Thẩm định văn bản')!;
    expect(copiedTask.id).not.toBe(task.id);
    expect(copiedTask.versionId).toBe(copy.id);
    expect(view.items.find((i) => i.code === 'A.003')!.taskId).toBe(copiedTask.id);
    expect(view.items.every((i) => view.tasks.some((t) => t.id === i.taskId))).toBe(true);
    expect(view.tasks).toHaveLength((await c.catalog.getVersion(version.id)).tasks.length);
  });

  it('phiên bản đã phê duyệt khóa cả nhiệm vụ', async () => {
    const { version } = await seedDraft(c);
    const task = await c.catalog.createTask(version.id, { groupCode: 'A', name: 'Nhiệm vụ cuối' });
    await c.catalog.approve(approver, version.id);
    await expect(c.catalog.createTask(version.id, { groupCode: 'A', name: 'Nhiệm vụ mới' })).rejects.toBeInstanceOf(ConflictException);
    await expect(c.catalog.updateTask(task.id, { name: 'Đổi tên' })).rejects.toBeInstanceOf(ConflictException);
    await expect(c.catalog.deleteTask(task.id)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CatalogService: tên danh mục của phiên bản', () => {
  let c: Catalog;
  beforeEach(async () => {
    c = await buildCatalog();
  });

  it('tên mặc định là nhãn; có thể đặt tên riêng, khoảng trắng được chuẩn hóa', async () => {
    const plain = await c.catalog.createVersion({ label: 'BTCTU 27.9.2026' });
    expect(plain).toMatchObject({ name: 'BTCTU 27.9.2026', label: 'BTCTU 27.9.2026' });

    const named = await c.catalog.createVersion({ label: 'BTCTU 05.10.2026', name: '  Danh mục công việc   của Ban Tổ chức  ' });
    expect(named).toMatchObject({ name: 'Danh mục công việc của Ban Tổ chức', label: 'BTCTU 05.10.2026' });
    expect(c.audit.find((a) => a.action === 'catalog.version.create' && a.details?.label === 'BTCTU 05.10.2026')?.details).toMatchObject({ name: 'Danh mục công việc của Ban Tổ chức' });
  });

  it('từ chối tên quá ngắn hoặc quá dài; nhãn vẫn duy nhất còn tên thì không cần duy nhất', async () => {
    await expect(c.catalog.createVersion({ label: 'Nhãn hợp lệ', name: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.createVersion({ label: 'Nhãn hợp lệ', name: 'x'.repeat(201) })).rejects.toBeInstanceOf(BadRequestException);
    await c.catalog.createVersion({ label: 'Nhãn một', name: 'Cùng một tên' });
    await expect(c.catalog.createVersion({ label: 'Nhãn hai', name: 'Cùng một tên' })).resolves.toBeTruthy();
    await expect(c.catalog.createVersion({ label: 'Nhãn một', name: 'Tên khác' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('bản sao kế thừa tên của bản gốc, trừ khi đặt tên mới', async () => {
    const source = await c.catalog.createVersion({ label: 'Gốc', name: 'Danh mục gốc' });
    const inherit = await c.catalog.createVersion({ label: 'Sao 1', copyFromVersionId: source.id });
    const override = await c.catalog.createVersion({ label: 'Sao 2', copyFromVersionId: source.id, name: 'Danh mục sửa' });
    expect(inherit.name).toBe('Danh mục gốc');
    expect(override.name).toBe('Danh mục sửa');
  });

  it('đổi tên bản nháp được và ghi nhật ký; nhãn không đổi; bản đã phê duyệt không đổi tên được', async () => {
    const { version } = await seedDraft(c);
    const renamed = await c.catalog.renameVersion(version.id, '  Tên   mới của danh mục ');
    expect(renamed).toMatchObject({ name: 'Tên mới của danh mục', label: version.label });
    expect(c.audit.at(-1)).toMatchObject({ action: 'catalog.version.rename', details: { after: 'Tên mới của danh mục' } });
    await expect(c.catalog.renameVersion(version.id, 'ab')).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.renameVersion('khong-co', 'Tên hợp lệ')).rejects.toBeInstanceOf(NotFoundException);

    await c.catalog.approve(approver, version.id);
    await expect(c.catalog.renameVersion(version.id, 'Đổi sau khi duyệt')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CatalogService: nhóm do người dùng thêm (ADR-020)', () => {
  let c: Catalog;
  beforeEach(async () => {
    c = await buildCatalog();
  });

  it('thêm nhóm: mã tự sinh là chữ cái kế tiếp còn trống, thứ tự nối tiếp, ghi nhật ký', async () => {
    const e = await c.catalog.createGroup({ name: '  Nhóm  công việc   mới ' });
    expect(e).toMatchObject({ code: 'E', name: 'Nhóm công việc mới', sortOrder: 5 });
    const f = await c.catalog.createGroup({ name: 'Nhóm thứ sáu' });
    expect(f.code).toBe('F');
    expect(c.audit.filter((a) => a.action === 'catalog.group.create')).toHaveLength(2);
  });

  it('chọn mã chữ cái còn trống; từ chối mã trùng, mã sai, tên ngắn hoặc trùng tên', async () => {
    expect((await c.catalog.createGroup({ code: 'x', name: 'Nhóm X' })).code).toBe('X'); // đổi thành chữ hoa
    await expect(c.catalog.createGroup({ code: 'X', name: 'Nhóm khác' })).rejects.toBeInstanceOf(ConflictException);
    await expect(c.catalog.createGroup({ code: 'A', name: 'Nhóm khác' })).rejects.toBeInstanceOf(ConflictException);
    for (const code of ['1', 'AB', '']) {
      await expect(c.catalog.createGroup({ code, name: 'Nhóm hợp lệ' })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(c.catalog.createGroup({ name: 'ab' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.createGroup({ name: 'x'.repeat(256) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.createGroup({ name: 'NHÓM x' })).rejects.toBeInstanceOf(ConflictException); // trùng tên (không phân biệt hoa thường)
  });

  it('tối đa 26 nhóm', async () => {
    for (let i = 0; i < 22; i += 1) await c.catalog.createGroup({ name: `Nhóm số ${i + 1}` }); // đã có A–D, thêm 22 nhóm → đủ 26
    await expect(c.catalog.createGroup({ name: 'Nhóm thứ 27' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('công việc và nhiệm vụ dùng được nhóm mới, mã tự sinh theo chữ cái của nhóm', async () => {
    const group = await c.catalog.createGroup({ name: 'Nhóm công việc đặc thù' });
    const version = await c.catalog.createVersion({ label: 'Nháp nhóm mới' });
    const task = await c.catalog.createTask(version.id, { groupCode: group.code, name: 'Nhiệm vụ đặc thù' });
    const item = await c.catalog.addItem(version.id, { name: 'Việc đặc thù', complexity: 2, durationMode: 'ACTUAL', taskId: task.id });
    expect(item).toMatchObject({ code: 'E.001', groupCode: 'E', taskId: task.id });
    expect((await c.catalog.getVersion(version.id)).groups.map((g) => g.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('sửa tên nhóm (mã không đổi), không trùng tên nhóm khác; nhóm không có thì 404', async () => {
    const renamed = await c.catalog.renameGroup('B', '  Tên mới   của nhóm B ');
    expect(renamed).toMatchObject({ code: 'B', name: 'Tên mới của nhóm B' });
    await expect(c.catalog.renameGroup('C', 'tên mới của nhóm b')).rejects.toBeInstanceOf(ConflictException);
    await expect(c.catalog.renameGroup('C', 'ab')).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.renameGroup('Z', 'Nhóm không có')).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.catalog.renameGroup('C', 'Nhóm C')).resolves.toMatchObject({ name: 'Nhóm C' }); // giữ nguyên tên của chính nó thì được
    expect(c.audit.at(-1)).toMatchObject({ action: 'catalog.group.rename' });
  });

  it('chỉ xóa nhóm chưa có nhiệm vụ hay công việc nào ở bất kỳ phiên bản nào', async () => {
    const group = await c.catalog.createGroup({ name: 'Nhóm tạm' });
    const version = await c.catalog.createVersion({ label: 'Nháp xóa nhóm' });
    const task = await c.catalog.createTask(version.id, { groupCode: group.code, name: 'Nhiệm vụ tạm' });
    await expect(c.catalog.deleteGroup(group.code)).rejects.toBeInstanceOf(ConflictException); // còn nhiệm vụ

    await c.catalog.deleteTask(task.id);
    await c.catalog.deleteGroup(group.code);
    expect((await c.catalog.getVersion(version.id)).groups.some((g) => g.code === group.code)).toBe(false);
    await expect(c.catalog.deleteGroup(group.code)).rejects.toBeInstanceOf(NotFoundException);

    const withItems = await seedDraft(c); // nhóm A, B đã có công việc
    await expect(c.catalog.deleteGroup('A')).rejects.toBeInstanceOf(ConflictException);
    expect(withItems.version.id).toBeTruthy();
  });
});


describe('CatalogService: phạm vi áp dụng của công việc (ADR-021)', () => {
  let c: Catalog;
  const UNIT = '00000000-0000-4000-8000-000000000001';
  const UNIT_2 = '00000000-0000-4000-8000-000000000002';
  const POSITION = '00000000-0000-4000-8000-0000000000a1';

  beforeEach(async () => {
    c = await buildCatalog();
  });

  it('công việc mới chưa có phạm vi nào: là việc chung', async () => {
    const { version } = await seedDraft(c);
    for (const i of (await c.catalog.getVersion(version.id)).items) expect(i).toMatchObject({ unitIds: [], positionIds: [] });
  });

  it('gán phạm vi cho một công việc, bỏ trùng, ghi nhật ký; gán rỗng thì về việc chung', async () => {
    const { version, items } = await seedDraft(c);
    const saved = await c.catalog.setItemScope(items.a3.id, { unitIds: [UNIT, UNIT], positionIds: [POSITION] });
    expect(saved).toEqual({ unitIds: [UNIT], positionIds: [POSITION] });
    expect(c.audit.at(-1)).toMatchObject({ action: 'catalog.item.scope' });

    const view = await c.catalog.getVersion(version.id);
    expect(view.items.find((i) => i.code === 'A.003')).toMatchObject({ unitIds: [UNIT], positionIds: [POSITION] });
    expect(view.items.find((i) => i.code === 'B.001')).toMatchObject({ unitIds: [], positionIds: [] });

    await c.catalog.setItemScope(items.a3.id, { unitIds: [], positionIds: [] });
    expect((await c.catalog.getVersion(version.id)).items.find((i) => i.code === 'A.003')).toMatchObject({ unitIds: [], positionIds: [] });
  });

  it('gán hàng loạt cho mọi công việc của một nhiệm vụ, thay thế phạm vi cũ', async () => {
    const { version, items } = await seedDraft(c);
    await c.catalog.setItemScope(items.a3.id, { unitIds: [UNIT_2], positionIds: [] });
    const taskId = items.a3.taskId;
    const inTask = (await c.catalog.getVersion(version.id)).items.filter((i) => i.taskId === taskId).length;

    const result = await c.catalog.setTaskScope(taskId, { unitIds: [UNIT], positionIds: [] });
    expect(result.items).toBe(inTask);
    const after = (await c.catalog.getVersion(version.id)).items.filter((i) => i.taskId === taskId);
    for (const i of after) expect(i).toMatchObject({ unitIds: [UNIT], positionIds: [] });
    expect(c.audit.at(-1)).toMatchObject({ action: 'catalog.task.scope' });
  });

  it('từ chối đơn vị, vị trí không có thật; công việc, nhiệm vụ không có', async () => {
    const { items } = await seedDraft(c);
    const ghost = '00000000-0000-4000-8000-00000000dead';
    await expect(c.catalog.setItemScope(items.a3.id, { unitIds: [ghost], positionIds: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.setItemScope(items.a3.id, { unitIds: [], positionIds: [ghost] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.catalog.setItemScope('khong-co', { unitIds: [], positionIds: [] })).rejects.toBeInstanceOf(NotFoundException);
    await expect(c.catalog.setTaskScope('khong-co', { unitIds: [], positionIds: [] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('phiên bản đã phê duyệt không sửa được phạm vi', async () => {
    const { version, items } = await seedDraft(c);
    await c.catalog.approve(approver, version.id);
    await expect(c.catalog.setItemScope(items.a3.id, { unitIds: [UNIT], positionIds: [] })).rejects.toBeInstanceOf(ConflictException);
    await expect(c.catalog.setTaskScope(items.a3.taskId, { unitIds: [UNIT], positionIds: [] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('sao chép phiên bản mang theo phạm vi sang công việc mới', async () => {
    const { version, items } = await seedDraft(c);
    await c.catalog.setItemScope(items.a3.id, { unitIds: [UNIT], positionIds: [POSITION] });
    const copy = await c.catalog.createVersion({ label: 'Bản sao có phạm vi', copyFromVersionId: version.id });
    const copied = (await c.catalog.getVersion(copy.id)).items.find((i) => i.code === 'A.003')!;
    expect(copied.id).not.toBe(items.a3.id);
    expect(copied).toMatchObject({ unitIds: [UNIT], positionIds: [POSITION] });
  });
});
