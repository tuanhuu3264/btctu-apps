import ExcelJS from 'exceljs';
import { buildExportFile, columnWidths, renderTableExport, safeText, sheetName } from './table-export.js';
import type { TableExport } from './table-export.js';

const table = (): TableExport => ({
  title: 'Danh sách thử',
  info: [['Phạm vi', 'Việc của tôi']],
  generatedAt: new Date('2026-10-16T03:00:00Z'),
  sheets: [
    {
      name: 'Việc',
      heading: 'Chi tiết',
      columns: [{ header: 'Họ tên', width: 30 }, { header: 'Số lượng', width: 10, align: 'right' }],
      rows: [['Nguyễn Văn Ắ', 5], ['=HYPERLINK("http://x")', null]],
    },
  ],
});

describe('khung xuất danh sách (A6.2)', () => {
  it('chặn ô văn bản bị Excel hiểu là công thức', () => {
    for (const v of ['=1+1', '+cmd', '-2', '@SUM(A1)']) expect(safeText(v)).toBe(`'${v}`);
    expect(safeText('Bình thường')).toBe('Bình thường');
  });

  it('tên trang tính hợp lệ, không trùng', () => {
    const used = new Set<string>();
    expect(sheetName('A/B?*[x]', used)).toBe('A B   x');
    expect(sheetName('a b   x', used)).not.toBe('A B   x');
    expect(sheetName('x'.repeat(50), new Set()).length).toBeLessThanOrEqual(31);
  });

  it('Excel: tiếng Việt có dấu, số giữ kiểu số, công thức bị vô hiệu', async () => {
    const buffer = await renderTableExport(table(), 'xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Việc')!;
    const values = ws.getSheetValues().flat().filter((v) => v !== undefined && v !== null);
    expect(values).toContain('Danh sách thử');
    expect(values).toContain('Nguyễn Văn Ắ');
    expect(values).toContain(5);
    expect(values).toContain(`'=HYPERLINK("http://x")`);
    expect(JSON.stringify(values)).not.toMatch(/"formula"/);
  });

  it('PDF: tệp PDF hợp lệ, có cả khi không có dòng nào', async () => {
    const pdf = await renderTableExport(table(), 'pdf');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const empty = table();
    empty.sheets[0].rows = [];
    expect((await renderTableExport(empty, 'pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('tên tệp theo ngày và loại nội dung', async () => {
    const f = await buildExportFile('viec-duoc-giao', table(), 'xlsx');
    expect(f.filename).toBe('viec-duoc-giao-2026-10-16.xlsx');
    expect(f.contentType).toContain('spreadsheetml');
  });

  it('độ rộng cột PDF: không hẹp hơn mức tối thiểu và tổng không vượt chỗ có (14 cột như danh sách việc)', () => {
    const cols = [6, 28, 34, 12, 22, 24, 24, 22, 9, 11, 12, 16, 9, 10].map((width) => ({ header: 'x', width }));
    const widths = columnWidths(cols, 700);
    expect(widths).toHaveLength(14);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(46);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(700);
    // Ít cột thì tỷ lệ giữ nguyên.
    expect(columnWidths([{ header: 'a', width: 10 }, { header: 'b', width: 30 }], 400)).toEqual([100, 300]);
  });
});
