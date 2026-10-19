import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BadRequestException } from '@nestjs/common';
import { readOrgRowsFromExcel } from '../data-access/excel-org-source.js';
import { planOrgImport, slug } from './org-import.plan.js';
import { buildOrg } from './testing/in-memory.js';

const HEADER = [
  'STT', 'Cấp', 'Khối', 'Phòng / đơn vị', 'Chức vụ', 'Họ và tên', 'Cấp quản lý trực tiếp',
  'Lĩnh vực / nhiệm vụ phụ trách', 'KPI – OKR then chốt', 'Ghi chú',
];

/** [cấp, phòng, chức vụ, họ tên, cấp quản lý trực tiếp] */
type Row = [number, string, string, string, string];

function sheet(rows: Row[]): string[][] {
  return [
    ['DANH SÁCH CÁN BỘ'],
    ['Tổng số vị trí đã rà: ' + rows.length],
    HEADER,
    ...rows.map(([level, dept, title, name, manager], i) => [
      String(i + 1), String(level), '', dept, title, name, manager, `Nhiệm vụ ${name}`, `OKR ${name}`, '',
    ]),
    ['Ghi chú cuối bảng', '', '', ''],
  ];
}

const VALID: Row[] = [
  [1, '—', 'Trưởng ban', 'Nguyễn Văn A', 'Tỉnh ủy'],
  [2, 'Phòng Tổ chức cán bộ', 'Phó Trưởng ban', 'Trần Thị B', 'Nguyễn Văn A'],
  [3, 'Phòng Tổ chức cán bộ', 'Trưởng phòng', 'Lê Văn C', 'Trần Thị B'],
  [5, 'Phòng Tổ chức cán bộ', 'Chuyên viên', 'Phạm Thị D', 'Lê Văn C'],
  [5, 'Văn phòng', 'Chuyên viên', '(Vị trí) Chuyển đổi số', 'Lê Văn C'],
];

describe('slug', () => {
  it('bỏ dấu, viết hoa, thay ký tự lạ bằng gạch nối', () => {
    expect(slug('Nguyễn Trần Thi')).toBe('NGUYEN-TRAN-THI');
    expect(slug('Đoàn Đức Dũng')).toBe('DOAN-DUC-DUNG');
    expect(slug('  Y Lucky  Niê ')).toBe('Y-LUCKY-NIE');
  });
});

describe('planOrgImport (hàm thuần)', () => {
  it('lập kế hoạch đúng từ bảng hợp lệ', () => {
    const plan = planOrgImport(sheet(VALID));
    expect(plan.errors).toEqual([]);
    expect(plan.units.map((u) => u.code)).toEqual(['BTCTU', 'TCCB', 'VP', 'TCDDV', 'BVCTNB']);

    const byName = Object.fromEntries(plan.positions.map((p) => [p.holderName ?? p.title, p]));
    expect(byName['Nguyễn Văn A']).toMatchObject({ unitCode: 'BTCTU', level: 1, reportsToCode: null, code: 'BTCTU-L1-NGUYEN-VAN-A' });
    expect(byName['Trần Thị B']).toMatchObject({ unitCode: 'BTCTU', level: 2, reportsToCode: 'BTCTU-L1-NGUYEN-VAN-A' });
    expect(byName['Lê Văn C']).toMatchObject({ unitCode: 'TCCB', reportsToCode: 'BTCTU-L2-TRAN-THI-B' });
    expect(byName['Phạm Thị D']).toMatchObject({ unitCode: 'TCCB', duties: 'Nhiệm vụ Phạm Thị D', referenceOkr: 'OKR Phạm Thị D' });
  });

  it('dòng "(Vị trí) …" là vị trí trống, không có người giữ', () => {
    const vacant = planOrgImport(sheet(VALID)).positions.find((p) => p.holderName === null);
    expect(vacant).toMatchObject({ unitCode: 'VP', level: 5, code: 'VP-L5-CHUYEN-DOI-SO', title: 'Chuyên viên – Chuyển đổi số' });
  });

  it('bỏ qua dòng tiêu đề, dòng ghi chú và dòng không có cấp', () => {
    expect(planOrgImport(sheet(VALID)).positions).toHaveLength(5);
  });

  it('gom mọi lỗi trong một lượt: đơn vị lạ, cấp trên không có, cấp trên không cao hơn, trùng họ tên', () => {
    const plan = planOrgImport(
      sheet([
        [1, '—', 'Trưởng ban', 'Nguyễn Văn A', 'Tỉnh ủy'],
        [3, 'Phòng Không Tồn Tại', 'Trưởng phòng', 'Lê Văn C', 'Nguyễn Văn A'],
        [3, 'Văn phòng', 'Trưởng phòng', 'Hoàng Văn E', 'Người Không Có'],
        [3, 'Văn phòng', 'Trưởng phòng', 'Ngô Văn F', 'Ngô Văn G'],
        [3, 'Văn phòng', 'Trưởng phòng', 'Ngô Văn G', 'Ngô Văn F'],
        [5, 'Văn phòng', 'Chuyên viên', 'Nguyễn Văn A', 'Hoàng Văn E'],
      ]),
    );
    const text = plan.errors.join('\n');
    expect(text).toMatch(/không nhận ra đơn vị "Phòng Không Tồn Tại"/);
    expect(text).toMatch(/không xác định được cấp trên "Người Không Có"/);
    expect(text).toMatch(/không thấp số cấp hơn/);
    expect(text).toMatch(/Họ tên xuất hiện ở 2 dòng/);
    expect(plan.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('báo lỗi khi không có dòng tiêu đề hoặc không có dữ liệu', () => {
    expect(planOrgImport([['a', 'b']]).errors[0]).toMatch(/dòng tiêu đề/);
    expect(planOrgImport(sheet([])).errors[0]).toMatch(/Không có dòng dữ liệu/);
  });
});

describe('OrgImportService.apply', () => {
  it('nhập đủ đơn vị, cán bộ, vị trí, phân công và quan hệ báo cáo', async () => {
    const org = await buildOrg();
    const summary = await org.importer.apply(planOrgImport(sheet(VALID)));
    expect(summary).toMatchObject({
      unitsCreated: 5,
      personsCreated: 4,
      positionsCreated: 5,
      assignmentsCreated: 4,
      warnings: [],
    });

    const lc = org.repos.positions.rows.find((p) => p.code === 'TCCB-L3-LE-VAN-C')!;
    const subordinates = await org.positions.subordinates(lc.id, { direct: true });
    expect(subordinates.map((p) => p.code).sort()).toEqual(['TCCB-L5-PHAM-THI-D', 'VP-L5-CHUYEN-DOI-SO']);
    expect(org.audit.some((a) => a.action === 'org.import')).toBe(true);
  });

  it('chạy lại không tạo trùng và không đổi gì', async () => {
    const org = await buildOrg();
    const plan = planOrgImport(sheet(VALID));
    await org.importer.apply(plan);
    const second = await org.importer.apply(plan);

    expect(second).toMatchObject({
      unitsCreated: 0,
      personsCreated: 0,
      positionsCreated: 0,
      positionsUpdated: 0,
      positionsUnchanged: 5,
      assignmentsCreated: 0,
      assignmentsUnchanged: 4,
    });
    expect(org.repos.persons.rows).toHaveLength(4);
    expect(org.repos.positions.rows).toHaveLength(5);
  });

  it('cập nhật vị trí khi nội dung trong Excel đổi, dùng lại cán bộ đã có', async () => {
    const org = await buildOrg();
    await org.persons.create({ fullName: 'Phạm Thị D', note: 'có sẵn' });
    await org.importer.apply(planOrgImport(sheet(VALID)));
    expect(org.repos.persons.rows.filter((p) => p.fullName === 'Phạm Thị D')).toHaveLength(1);

    const changed = VALID.map((r) => (r[3] === 'Phạm Thị D' ? ([...r.slice(0, 2), 'Chuyên viên chính', ...r.slice(3)] as Row) : r));
    const summary = await org.importer.apply(planOrgImport(sheet(changed)));
    expect(summary.positionsUpdated).toBe(1);
    expect(org.repos.positions.rows.find((p) => p.code === 'TCCB-L5-PHAM-THI-D')?.title).toBe('Chuyên viên chính');
  });

  it('cảnh báo (không dừng) khi cán bộ đang giữ một vị trí khác', async () => {
    const org = await buildOrg();
    await org.importer.apply(planOrgImport(sheet(VALID)));

    // Lần nhập sau đưa Phạm Thị D sang vị trí mới ở Văn phòng, nhưng phân công cũ ở TCCB vẫn còn mở.
    const movedPlan = planOrgImport(sheet([...VALID.slice(0, 3), [5, 'Văn phòng', 'Chuyên viên', 'Phạm Thị D', 'Lê Văn C']]));
    const summary = await org.importer.apply(movedPlan);

    expect(summary.positionsCreated).toBe(1);
    expect(summary.assignmentsCreated).toBe(0);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toMatch(/Không phân công được cho vị trí VP-L5-PHAM-THI-D/);
  });

  it('từ chối áp dụng kế hoạch có lỗi và không ghi gì', async () => {
    const org = await buildOrg();
    const plan = planOrgImport(sheet([[3, 'Phòng Lạ', 'Trưởng phòng', 'Lê Văn C', 'X']]));
    await expect(org.importer.apply(plan)).rejects.toBeInstanceOf(BadRequestException);
    expect(org.repos.units.rows).toHaveLength(0);
  });
});

const REAL_FILE = fileURLToPath(
  new URL('../../../../../../docs/tai_lieu_tham_khao/Cay_so_do_phan_cong_nhiem_vu_Ban_To_chuc_Tinh_uy (3).xlsx', import.meta.url),
);

describe.skipIf(!existsSync(REAL_FILE))('trên tệp Excel thật của Ban', () => {
  it('đọc được, không có lỗi, cây hợp lệ và nhập lặp lại ổn định', async () => {
    const plan = planOrgImport(await readOrgRowsFromExcel(REAL_FILE));
    expect(plan.errors).toEqual([]);
    expect(plan.units).toHaveLength(5);
    expect(plan.positions).toHaveLength(39);
    expect(plan.positions.filter((p) => p.holderName)).toHaveLength(38);

    // Đúng một vị trí cấp 1; mọi vị trí còn lại đều có cấp trên có số cấp nhỏ hơn.
    const byCode = new Map(plan.positions.map((p) => [p.code, p]));
    expect(plan.positions.filter((p) => p.level === 1)).toHaveLength(1);
    for (const p of plan.positions.filter((x) => x.level > 1)) {
      expect(byCode.get(p.reportsToCode!)!.level).toBeLessThan(p.level);
    }

    const org = await buildOrg();
    const first = await org.importer.apply(plan);
    expect(first).toMatchObject({ positionsCreated: 39, assignmentsCreated: 38, warnings: [] });
    const second = await org.importer.apply(plan);
    expect(second).toMatchObject({ positionsCreated: 0, positionsUpdated: 0, assignmentsCreated: 0, personsCreated: 0 });
  });
});
