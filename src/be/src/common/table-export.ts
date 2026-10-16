import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import pdfmake from 'pdfmake';

/**
 * Khung xuất danh sách ra Excel và PDF (PLAN-A A6.2), dùng chung cho các danh sách: việc được giao, nhật ký, tổ chức.
 * Người dùng của khung chỉ dựng `TableExport` (tiêu đề, thông tin chung, các bảng); định dạng do khung lo.
 * Chỉ nhận chuỗi, số, rỗng: không có công thức hay đường dẫn, và ô văn bản bắt đầu bằng = + - @ được chặn để Excel không chạy như công thức.
 */

export type TableFormat = 'xlsx' | 'pdf';
export const TABLE_FORMATS: readonly TableFormat[] = ['xlsx', 'pdf'];

export const TABLE_CONTENT_TYPES: Record<TableFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

export type TableCell = string | number | null | undefined;

export interface TableColumn {
  header: string;
  /** Độ rộng tương đối (xấp xỉ số ký tự). */
  width?: number;
  align?: 'left' | 'right' | 'center';
}

export interface TableSheet {
  /** Tên trang tính (tối đa 31 ký tự, bỏ ký tự Excel không cho). */
  name: string;
  /** Tiêu đề phần, hiện trong PDF và dòng đầu của trang tính. */
  heading?: string;
  columns: TableColumn[];
  rows: TableCell[][];
}

export interface TableExport {
  title: string;
  /** Các dòng thông tin chung, ví dụ ["Phạm vi", "Việc của cấp dưới"]. */
  info: [string, string][];
  sheets: TableSheet[];
  generatedAt: Date;
}

/** Số dòng tối đa mỗi lần xuất, để một yêu cầu không làm máy chủ cạn bộ nhớ. */
export const MAX_EXPORT_ROWS: Record<TableFormat, number> = { xlsx: 20_000, pdf: 3_000 };

const GENERATOR = 'Phần mềm quản lý, đánh giá KPI/OKR – Ban Tổ chức Tỉnh ủy Đắk Lắk';
const FONT_DIR = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');

let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  pdfmake.setFonts({
    Roboto: {
      normal: join(FONT_DIR, 'Roboto-Regular.ttf'),
      bold: join(FONT_DIR, 'Roboto-Medium.ttf'),
      italics: join(FONT_DIR, 'Roboto-Italic.ttf'),
      bolditalics: join(FONT_DIR, 'Roboto-MediumItalic.ttf'),
    },
  });
  // Chỉ cho đọc phông đi kèm thư viện, không tải tài nguyên ngoài.
  pdfmake.setUrlAccessPolicy(() => false);
  const fontRoot = resolve(FONT_DIR) + sep;
  pdfmake.setLocalAccessPolicy((path: string) => resolve(path).startsWith(fontRoot));
  fontsReady = true;
}

/** Văn bản bắt đầu bằng ký tự mà Excel hiểu là công thức thì thêm dấu nháy đơn phía trước. */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const cellText = (c: TableCell): string => (c === null || c === undefined ? '' : typeof c === 'number' ? String(c).replace('.', ',') : c);

export function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || 'Trang';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 28)} ${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function totalRows(table: TableExport): number {
  return table.sheets.reduce((n, s) => n + s.rows.length, 0);
}

export async function renderTableExport(table: TableExport, format: TableFormat): Promise<Buffer> {
  return format === 'xlsx' ? renderExcel(table) : renderPdf(table);
}

async function renderExcel(table: TableExport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = GENERATOR;
  wb.created = table.generatedAt;
  const used = new Set<string>();
  for (const sheet of table.sheets) {
    const ws = wb.addWorksheet(sheetName(sheet.name, used));
    ws.columns = sheet.columns.map((c) => ({ width: c.width ?? 16 }));
    ws.addRow([safeText(table.title)]).font = { bold: true, size: 13 };
    for (const [k, v] of table.info) ws.addRow([safeText(k), safeText(v)]);
    ws.addRow(['Thời điểm lập', table.generatedAt.toISOString()]);
    if (sheet.heading) {
      ws.addRow([]);
      ws.addRow([safeText(sheet.heading)]).font = { bold: true };
    }
    ws.addRow([]);
    const header = ws.addRow(sheet.columns.map((c) => c.header));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    for (const r of sheet.rows) {
      const row = ws.addRow(r.map((c) => (typeof c === 'string' ? safeText(c) : (c ?? null))));
      sheet.columns.forEach((col, i) => {
        row.getCell(i + 1).alignment = { vertical: 'top', wrapText: true, horizontal: col.align };
      });
    }
    ws.views = [{ state: 'frozen', ySplit: ws.rowCount - sheet.rows.length }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function renderPdf(table: TableExport): Promise<Buffer> {
  ensureFonts();
  const usable = 770; // khổ A4 ngang trừ lề
  const content: unknown[] = [
    { text: table.title, style: 'title' },
    ...table.info.map(([k, v]) => ({ text: `${k}: ${v}` })),
    { text: `Lập lúc ${table.generatedAt.toISOString()}`, italics: true },
  ];
  for (const sheet of table.sheets) {
    const room = usable - 6 * sheet.columns.length - 4; // khoảng đệm ô và viền
    if (sheet.heading) content.push({ text: sheet.heading, style: 'h2' });
    content.push({
      table: {
        headerRows: 1,
        widths: columnWidths(sheet.columns, room),
        body: [
          sheet.columns.map((c) => ({ text: c.header, bold: true, fillColor: '#e8eef7', alignment: c.align })),
          ...sheet.rows.map((r) => sheet.columns.map((c, i) => ({ text: cellText(r[i]), alignment: c.align }))),
        ],
      },
      layout: { hLineWidth: (i: number) => (i <= 1 ? 0.8 : 0.3), vLineWidth: () => 0, hLineColor: () => '#bbbbbb', paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
      margin: [0, sheet.heading ? 0 : 8, 0, 0],
    });
    if (sheet.rows.length === 0) content.push({ text: 'Không có dữ liệu.', italics: true, margin: [0, 4, 0, 0] });
  }
  const document = pdfmake.createPdf({
    pageOrientation: 'landscape',
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { font: 'Roboto', fontSize: 8 },
    styles: { title: { fontSize: 13, bold: true, margin: [0, 0, 0, 6] }, h2: { fontSize: 10, bold: true, margin: [0, 10, 0, 4] } },
    content,
    footer: (currentPage: number, pageCount: number) => ({ text: `${GENERATOR} – trang ${currentPage}/${pageCount}`, alignment: 'center', fontSize: 7, color: '#666666' }),
  } as Parameters<typeof pdfmake.createPdf>[0]);
  return Buffer.from(await document.getBuffer());
}

/**
 * Độ rộng cột PDF (điểm): tỷ lệ theo `width` nhưng không hẹp hơn mức tối thiểu để chữ không bị bẻ từng ký tự; phần vượt quá chỗ có
 * được trừ dần vào các cột rộng để bảng không tràn mép phải.
 */
export function columnWidths(columns: readonly TableColumn[], room: number): number[] {
  const MIN = 46;
  const total = columns.reduce((n, c) => n + (c.width ?? 16), 0);
  const widths = columns.map((c) => Math.max(MIN, Math.floor(((c.width ?? 16) / total) * room)));
  for (let guard = 0; guard < 10 && widths.reduce((a, b) => a + b, 0) > room; guard++) {
    const over = widths.reduce((a, b) => a + b, 0) - room;
    const flexible = widths.reduce((n, w) => n + Math.max(0, w - MIN), 0);
    if (flexible <= 0) break;
    for (let i = 0; i < widths.length; i++) widths[i] = Math.max(MIN, widths[i] - Math.ceil((over * Math.max(0, widths[i] - MIN)) / flexible));
  }
  return widths;
}

export interface ExportedTable {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

/** Dựng tệp từ bảng; tên tệp dạng `<base>-<ngày>.<đuôi>`. */
export async function buildExportFile(base: string, table: TableExport, format: TableFormat): Promise<ExportedTable> {
  const buffer = await renderTableExport(table, format);
  return { filename: `${base}-${table.generatedAt.toISOString().slice(0, 10)}.${format}`, contentType: TABLE_CONTENT_TYPES[format], buffer };
}
