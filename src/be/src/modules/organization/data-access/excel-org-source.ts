import ExcelJS from 'exceljs';
import { ORG_SHEET_NAME } from '../application/org-import.plan.js';

/** Đọc sheet danh sách cán bộ từ tệp Excel thành bảng chuỗi (adapter ra ngoài, tách khỏi quy tắc nghiệp vụ). */
export async function readOrgRowsFromExcel(filePath: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(ORG_SHEET_NAME);
  if (!sheet) {
    const names = workbook.worksheets.map((w) => w.name).join(', ');
    throw new Error(`Không có sheet "${ORG_SHEET_NAME}" trong tệp (các sheet hiện có: ${names})`);
  }
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) cells.push((row.getCell(c).text ?? '').normalize('NFC'));
    rows[rowNumber - 1] = cells;
  });
  return Array.from(rows, (r) => r ?? []);
}
