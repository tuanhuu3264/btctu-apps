import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { readCatalogRowsFromExcel } from '../data-access/excel-catalog-source.js';
import { planCatalogImport } from './catalog-import.plan.js';
import type { CatalogSheetRow } from './catalog-import.plan.js';
import { buildCatalog } from './testing/in-memory.js';

const HEADER = ['Mã/ Nhiệm vụ', 'Tên công việc', 'Tên \nsản phẩm', 'Phân nhóm/ Mức độ phức tạp', 'Thời gian \ntối đa (giờ)', 'Điểm chấm', 'Hệ số quy đổi', 'Diễn giải'];

/** [mã, tên, sản phẩm, mức phức tạp, thời gian, điểm, ghi chú] hoặc ['A', 'tên nhóm'] cho dòng nhóm. */
type Line = string[];

/** Dựng các dòng giống sheet thật; công thức hệ số trỏ tới dòng của `baselineCode` như `F5/$F$21`. */
function sheet(lines: Line[], baselineCode: string | null): CatalogSheetRow[] {
  const rowOf = (code: string) => 3 + lines.findIndex((l) => l[0] === code); // 2 dòng đầu + 1 để dòng thứ i là i+3
  const rows: CatalogSheetRow[] = [
    { rowNumber: 1, cells: ['Ví dụ danh mục', ...Array(7).fill('')], formulas: Array(8).fill(null) },
    { rowNumber: 2, cells: HEADER, formulas: Array(8).fill(null) },
  ];
  lines.forEach((l, i) => {
    const rowNumber = i + 3;
    if (l.length === 2) {
      rows.push({ rowNumber, cells: [l[0], l[1], l[1], '', '', '', '', ''], formulas: Array(8).fill(null) });
      return;
    }
    const [code, name, product, complexity, duration, points, note = ''] = l;
    const formulas: (string | null)[] = Array(8).fill(null);
    if (baselineCode) formulas[6] = `F${rowNumber}/$F$${rowOf(baselineCode)}`;
    rows.push({ rowNumber, cells: [code, name, product, complexity, duration, points, '', note], formulas });
  });
  return rows;
}

const VALID: Line[] = [
  ['A', 'NHÓM CÔNG VIỆC LÃNH ĐẠO'],
  ['A.001', 'Nghiên cứu văn bản', 'Văn bản', '1', 'Thực tế', '10'],
  ['A.002', 'Thẩm định', 'Văn bản', '3', '4', '120', 'Ghi chú'],
  ['B', 'NHÓM DÙNG CHUNG'],
  ['B.001', 'Phân loại, lưu trữ', 'Hồ sơ', '2', '4', '90'],
  ['B.002', 'Quyết toán', 'Chứng từ', '4', '60 ngày', '400'],
  ['B.003', 'Việc chưa định mức', 'Cuộc', '3', '', ''],
];

describe('planCatalogImport (hàm thuần)', () => {
  it('lập kế hoạch đúng: nhóm, công việc, chuẩn xác định từ công thức', () => {
    const plan = planCatalogImport(sheet(VALID, 'B.001'));
    expect(plan.errors).toEqual([]);
    expect(plan.groups.map((g) => g.code)).toEqual(['A', 'B']);
    expect(plan.items.map((i) => i.code)).toEqual(['A.001', 'A.002', 'B.001', 'B.002', 'B.003']);
    expect(plan.baselineCode).toBe('B.001');
    expect(plan.items.map((i) => i.sortOrder)).toEqual([1, 2, 3, 4, 5]);
  });

  it('hiểu ba kiểu thời gian: giờ, "Thực tế", ngày; để trống thành chưa nêu', () => {
    const by = Object.fromEntries(planCatalogImport(sheet(VALID, 'B.001')).items.map((i) => [i.code, i]));
    expect(by['A.002']).toMatchObject({ durationMode: 'LIMITED', durationValue: 4, durationUnit: 'HOUR', explanation: 'Ghi chú' });
    expect(by['A.001']).toMatchObject({ durationMode: 'ACTUAL', durationValue: null, durationUnit: null });
    expect(by['B.002']).toMatchObject({ durationMode: 'LIMITED', durationValue: 60, durationUnit: 'DAY' });
    expect(by['B.003']).toMatchObject({ durationMode: 'UNSPECIFIED', points: null });
  });

  it('cảnh báo (không lỗi) với điểm trống, thời gian trống, thời gian tính theo ngày', () => {
    const warnings = planCatalogImport(sheet(VALID, 'B.001')).warnings.join('\n');
    expect(warnings).toMatch(/B\.003 chưa có điểm chấm/);
    expect(warnings).toMatch(/B\.003 chưa nêu thời gian/);
    expect(warnings).toMatch(/B\.002 có thời gian tính theo ngày/);
  });

  it('chấp nhận số thập phân dùng dấu phẩy', () => {
    const lines = VALID.map((l) => (l[0] === 'A.002' ? [...l.slice(0, 4), '0,5', ...l.slice(5)] : l));
    expect(planCatalogImport(sheet(lines, 'B.001')).items.find((i) => i.code === 'A.002')?.durationValue).toBe(0.5);
  });

  it('dự phòng: không có công thức thì lấy công việc duy nhất có hệ số ghi bằng 1', () => {
    const rows = sheet(VALID, null).map((r) => (r.cells[0] === 'B.001' ? { ...r, cells: r.cells.map((c, i) => (i === 6 ? '1' : c)) } : r));
    expect(planCatalogImport(rows).baselineCode).toBe('B.001');
  });

  it('không xác định được chuẩn thì cảnh báo, baseline rỗng', () => {
    const plan = planCatalogImport(sheet(VALID, null));
    expect(plan.baselineCode).toBeNull();
    expect(plan.warnings.join('\n')).toMatch(/Không xác định được công việc chuẩn/);
  });

  it('gom mọi lỗi: mức phức tạp, thời gian, điểm không phải số, trùng mã, thiếu nhóm, tên trống', () => {
    const plan = planCatalogImport(
      sheet(
        [
          ['A', 'NHÓM A'],
          ['A.001', 'Việc 1', 'x', '9', '1', '10'],
          ['A.002', 'Việc 2', 'x', '1', 'sớm nhất có thể', '10'],
          ['A.003', 'Việc 3', 'x', '1', '1', 'mười'],
          ['A.004', 'Việc 4', 'x', '1', '1', '10'],
          ['A.004', 'Việc 4 trùng', 'x', '1', '1', '10'],
          ['A.005', '', 'x', '1', '1', '10'],
          ['C.001', 'Việc nhóm C không có tiêu đề nhóm', 'x', '1', '1', '10'],
        ],
        'A.004',
      ),
    );
    const text = plan.errors.join('\n');
    expect(text).toMatch(/A\.001.*mức độ phức tạp/);
    expect(text).toMatch(/A\.002.*không hiểu thời gian/);
    expect(text).toMatch(/A\.003.*điểm chấm không phải số/);
    expect(text).toMatch(/Mã công việc bị trùng: A\.004/);
    expect(text).toMatch(/A\.005.*thiếu tên/);
    expect(text).toMatch(/nhóm C/);
  });

  it('công việc chuẩn không có điểm là lỗi', () => {
    const plan = planCatalogImport(sheet(VALID, 'B.003'));
    expect(plan.errors.join('\n')).toMatch(/Công việc chuẩn B\.003/);
  });

  it('báo lỗi khi không có dòng tiêu đề hoặc không có công việc', () => {
    expect(planCatalogImport([{ rowNumber: 1, cells: ['a'], formulas: [null] }]).errors[0]).toMatch(/dòng tiêu đề/);
    expect(planCatalogImport(sheet([['A', 'NHÓM A']], null)).errors.join('\n')).toMatch(/Không có công việc/);
  });
});

describe('CatalogImportService.apply', () => {
  it('tạo bản nháp mới có đủ nhóm, công việc, công việc chuẩn và hệ số đúng', async () => {
    const c = await buildCatalog();
    const result = await c.importer.apply(planCatalogImport(sheet(VALID, 'B.001')), { label: 'Nhập thử', sourceNote: 'Nhập từ tệp thử.xlsx' });

    expect(result).toMatchObject({ label: 'Nhập thử', itemsCreated: 5, baselineCode: 'B.001' });
    const view = await c.catalog.getVersion(result.versionId);
    expect(view.version).toMatchObject({ status: 'DRAFT', baselineItemCode: 'B.001', sourceNote: 'Nhập từ tệp thử.xlsx' });
    expect(view.items.find((i) => i.code === 'A.002')!.coefficient).toBeCloseTo(120 / 90, 10);
    expect(view.items.find((i) => i.code === 'B.003')).toMatchObject({ coefficient: null, needsScoring: true });
  });

  it('không bao giờ ghi đè phiên bản có sẵn: nhãn trùng thì dừng', async () => {
    const c = await buildCatalog();
    const plan = planCatalogImport(sheet(VALID, 'B.001'));
    await c.importer.apply(plan, { label: 'Nhập thử' });
    await expect(c.importer.apply(plan, { label: 'Nhập thử' })).rejects.toBeInstanceOf(ConflictException);
    expect(c.repos.versions.rows).toHaveLength(1);
  });

  it('từ chối kế hoạch có lỗi và không ghi gì', async () => {
    const c = await buildCatalog();
    const plan = planCatalogImport(sheet([['A', 'NHÓM A'], ['A.001', 'x', 'x', '9', '1', '1']], null));
    await expect(c.importer.apply(plan, { label: 'Lỗi' })).rejects.toBeInstanceOf(BadRequestException);
    expect(c.repos.versions.rows).toHaveLength(0);
  });
});

const REAL_FILE = fileURLToPath(
  new URL('../../../../../../docs/tai_lieu_tham_khao/Danh mục công việc của BTCTU 27.9.2026.xlsx', import.meta.url),
);

describe.skipIf(!existsSync(REAL_FILE))('trên tệp Excel thật của Ban', () => {
  it('đọc được, công việc chuẩn là B.009 (90 điểm), hệ số khớp từng dòng với hệ số có sẵn trong tệp', async () => {
    const rows = await readCatalogRowsFromExcel(REAL_FILE);
    const plan = planCatalogImport(rows);
    expect(plan.errors).toEqual([]);
    expect(plan.groups.map((g) => g.code)).toEqual(['A', 'B', 'C', 'D']);
    expect(plan.items).toHaveLength(49);
    expect(plan.baselineCode).toBe('B.009');

    const c = await buildCatalog();
    const { versionId } = await c.importer.apply(plan, { label: 'Tệp thật' });
    const view = await c.catalog.getVersion(versionId);
    expect(view.baseline).toEqual({ code: 'B.009', points: 90 });

    // So với cột "Hệ số quy đổi" mà Excel đã tính sẵn: phải khớp từng dòng có điểm.
    let compared = 0;
    for (const row of rows) {
      const item = view.items.find((i) => i.code === row.cells[0]);
      const cached = Number(row.cells[6]);
      if (!item || item.coefficient === null || !Number.isFinite(cached) || row.cells[6] === '') continue;
      expect(item.coefficient, item.code).toBeCloseTo(cached, 9);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(45);
  });

  it('các đặc điểm của dữ liệu thật được ghi nhận đúng', async () => {
    const plan = planCatalogImport(await readCatalogRowsFromExcel(REAL_FILE));
    const by = Object.fromEntries(plan.items.map((i) => [i.code, i]));
    expect(by['A.007']).toMatchObject({ points: null, durationMode: 'ACTUAL' }); // chưa có điểm chấm
    expect(by['B.023']).toMatchObject({ durationMode: 'LIMITED', durationValue: 60, durationUnit: 'DAY' });
    expect(by['A.001']).toMatchObject({ durationMode: 'ACTUAL', points: 10, complexity: 1 });
    expect(by['B.009']).toMatchObject({ points: 90, complexity: 2, durationValue: 4, durationUnit: 'HOUR' });
    expect(plan.warnings.filter((w) => /chưa có điểm chấm/.test(w))).toHaveLength(1);
  });
});
