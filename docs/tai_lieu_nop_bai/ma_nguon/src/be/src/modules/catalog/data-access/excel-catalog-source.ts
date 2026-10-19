import ExcelJS from 'exceljs';
import type { CatalogSheetRow } from '../application/catalog-import.plan.js';

const MAX_COLUMNS = 12; // các cột sau cột "Diễn giải" chỉ là ô nháp, không thuộc danh mục

/** Công thức của ô, kể cả công thức dùng chung (shared formula) lấy từ ô gốc. */
function formulaOf(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v === null || typeof v !== 'object' || v instanceof Date) return null;
  if ('formula' in v && typeof v.formula === 'string') return v.formula;
  if ('sharedFormula' in v && typeof v.sharedFormula === 'string') {
    const master = sheet.getCell(v.sharedFormula).value;
    if (master && typeof master === 'object' && 'formula' in master && typeof master.formula === 'string') return master.formula;
  }
  return null;
}

/** Đọc sheet đầu tiên của tệp danh mục thành các dòng (chữ hiển thị và công thức từng ô). */
export async function readCatalogRowsFromExcel(filePath: string): Promise<CatalogSheetRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Tệp không có sheet nào');

  const rows: CatalogSheetRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    const formulas: (string | null)[] = [];
    for (let c = 1; c <= MAX_COLUMNS; c++) {
      const cell = row.getCell(c);
      cells.push((cell.text ?? '').normalize('NFC')); // cùng một chữ có thể được lưu ở nhiều dạng Unicode
      formulas.push(formulaOf(sheet, cell));
    }
    rows.push({ rowNumber, cells, formulas });
  });
  return rows;
}
