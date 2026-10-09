import ExcelJS from 'exceljs';
import { approved, pending, report } from '../application/testing/fixtures.js';
import { FileReportRenderer } from './file-report-renderer.js';

const renderer = new FileReportRenderer();

const sample = report([
  approved('Nguyễn Thượng Hải', 92.5, 'XUAT_SAC', { positionTitle: 'Phó Trưởng ban', level: 2, unitName: 'Ban Tổ chức Tỉnh ủy', unitCode: 'BTCTU', generalScore: 28, resultScore: 64.5 }),
  approved('Đoàn Đức Dũng', 81, 'HOAN_THANH_TOT', { unitName: 'Văn phòng', unitCode: 'VP', positionTitle: 'Phó Chánh Văn phòng' }),
  pending('Phạm Thị Xuyến', 'SELF_SUBMITTED', { unitName: 'Văn phòng', unitCode: 'VP' }),
]);

describe('FileReportRenderer: Excel', () => {
  it('tạo tệp xlsx đọc lại được, có hai sheet và đủ dấu tiếng Việt', async () => {
    const buffer = await renderer.renderExcel(sample);
    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // xlsx là tệp zip

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Tổng hợp', 'Chi tiết']);

    const detail = wb.getWorksheet('Chi tiết')!;
    expect(detail.getRow(1).values).toEqual([undefined, 'STT', 'Họ và tên', 'Đơn vị', 'Chức vụ', 'Trạng thái', 'Điểm tiêu chí chung', 'Điểm kết quả nhiệm vụ', 'Tổng điểm', 'Xếp loại']);
    expect(detail.rowCount).toBe(4); // tiêu đề + 3 hồ sơ
    const names = [2, 3, 4].map((r) => detail.getRow(r).getCell(2).value);
    expect(names.sort()).toEqual(['Nguyễn Thượng Hải', 'Phạm Thị Xuyến', 'Đoàn Đức Dũng'].sort());
  });

  it('điểm là số (không phải chữ), hồ sơ chưa có điểm để trống', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderer.renderExcel(sample)) as unknown as ArrayBuffer);
    const detail = wb.getWorksheet('Chi tiết')!;
    const byName = new Map<string, ExcelJS.Row>();
    detail.eachRow((row, n) => n > 1 && byName.set(String(row.getCell(2).value), row));

    const hai = byName.get('Nguyễn Thượng Hải')!;
    expect(hai.getCell(8).value).toBe(92.5);
    expect(hai.getCell(6).value).toBe(28);
    expect(hai.getCell(9).value).toBe('Hoàn thành xuất sắc nhiệm vụ');
    const xuyen = byName.get('Phạm Thị Xuyến')!;
    expect(xuyen.getCell(8).value).toBeNull();
    expect(xuyen.getCell(9).value).toBeNull();
    expect(xuyen.getCell(5).value).toBe('Đã tự chấm, chờ thẩm định');
  });

  it('sheet tổng hợp có số liệu chung, theo đơn vị và các lưu ý', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderer.renderExcel(sample)) as unknown as ArrayBuffer);
    const text: string[] = [];
    wb.getWorksheet('Tổng hợp')!.eachRow((row) => text.push(row.values instanceof Array ? row.values.filter((v) => v !== undefined && v !== null).join(' | ') : ''));
    const all = text.join('\n');

    expect(all).toContain('2026-Q3 (2026-07-01 đến 2026-09-30)');
    expect(all).toContain('Tổng số hồ sơ | 3');
    expect(all).toContain('Đã phê duyệt | 2');
    expect(all).toContain('Điểm trung bình (đã phê duyệt) | 86.75');
    expect(all).toContain('Hoàn thành xuất sắc nhiệm vụ | 1');
    expect(all).toContain('Văn phòng | 2 | 1');
    expect(all).toMatch(/ngưỡng điểm 90\/70\/50/);
  });

  it('tên bắt đầu bằng ký tự công thức vẫn được lưu là chữ, không thành công thức', async () => {
    const evil = report([approved('=HYPERLINK("http://x","bấm")', 80, 'HOAN_THANH_TOT'), approved('+1+1', 80, 'HOAN_THANH_TOT')]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderer.renderExcel(evil)) as unknown as ArrayBuffer);
    const detail = wb.getWorksheet('Chi tiết')!;
    for (const r of [2, 3]) {
      const value = detail.getRow(r).getCell(2).value;
      expect(typeof value).toBe('string');
    }
  });

  it('báo cáo rỗng vẫn xuất được', async () => {
    const buffer = await renderer.renderExcel(report([]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Chi tiết')!.rowCount).toBe(1);
  });
});

describe('FileReportRenderer: PDF', () => {
  it('tạo tệp PDF hợp lệ có nội dung', async () => {
    const buffer = await renderer.renderPdf(sample);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(5_000);
    expect(buffer.subarray(-6).toString()).toContain('%%EOF');
  });

  it('chạy lặp lại và với báo cáo rỗng không lỗi', async () => {
    await expect(renderer.renderPdf(report([]))).resolves.toBeDefined();
    await expect(renderer.renderPdf(sample)).resolves.toBeDefined();
  });

  it('nhiều dòng thì chia nhiều trang mà không lỗi', async () => {
    const many = report(Array.from({ length: 120 }, (_, i) => approved(`Cán bộ số ${i + 1}`, 70 + (i % 25), 'HOAN_THANH_TOT')));
    const buffer = await renderer.renderPdf(many);
    expect(buffer.length).toBeGreaterThan(sample ? 10_000 : 0);
  });
});
