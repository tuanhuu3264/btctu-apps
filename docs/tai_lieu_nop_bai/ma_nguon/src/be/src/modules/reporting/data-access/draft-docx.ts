import { AlignmentType, BorderStyle, Document, Footer, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import type { Draft } from '../application/draft-templates.js';

const FONT = 'Times New Roman';
const SIZE = 28; // 14 pt, cỡ chữ thông dụng của văn bản hành chính (đơn vị half-point)
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER };

const run = (text: string, over: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, font: FONT, size: over.size ?? SIZE, bold: over.bold, italics: over.italics, color: over.color });

/** Hai cột không viền (cơ quan ban hành | quốc hiệu, số | địa danh ngày tháng) cho các dòng đầu văn bản. */
function twoColumns(left: string, right: string): Table {
  const cell = (text: string, bold: boolean) =>
    new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(text, { bold, size: 26 })] })],
    });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: { ...NO_BORDERS, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER }, rows: [new TableRow({ children: [cell(left, true), cell(right, true)] })] });
}

/**
 * Dựng tệp Word từ dự thảo dạng chữ (ADR-028). Mẫu dự thảo canh cột bằng dấu cách nên đọc lại theo quy ước:
 * dòng có khoảng trắng dài giữa hai đoạn chữ là hai cột, dòng thụt sâu là chữ ký (canh phải), dòng "- " là gạch đầu dòng.
 */
export async function renderDraftDocx(draft: Draft): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({ spacing: { after: 120 }, children: [run(draft.disclaimer, { italics: true, size: 22, color: 'C8102E' })] }),
  ];
  let titleLines = 0; // hai dòng liền sau "BÁO CÁO"/"QUYẾT ĐỊNH" là tên văn bản, in đậm canh giữa

  for (const raw of draft.body.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const pair = /^(\S.*?\S) {5,}(\S.*)$/.exec(line);
    if (pair) {
      children.push(twoColumns(pair[1], pair[2]));
    } else if (line.trim() === '') {
      children.push(new Paragraph({ children: [] }));
    } else if (/^ {10,}/.test(line)) {
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, indent: { left: 5200 }, children: [run(line.trim(), { bold: true })] }));
    } else if (line === 'BÁO CÁO' || line === 'QUYẾT ĐỊNH' || line === 'THÔNG BÁO') {
      titleLines = 2;
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, children: [run(line, { bold: true, size: 32 })] }));
    } else if (titleLines > 0 || line === 'TRƯỞNG BAN TỔ CHỨC TỈNH ỦY' || line === 'QUYẾT ĐỊNH:') {
      titleLines = Math.max(0, titleLines - 1);
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(line, { bold: true })] }));
    } else if (/^[IVX]+\. /.test(line) || /^Điều \d+\./.test(line)) {
      children.push(new Paragraph({ spacing: { before: 120, after: 60 }, children: [run(line, { bold: true })] }));
    } else if (line.startsWith('- ')) {
      children.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 60 }, children: [run(`• ${line.slice(2)}`)] }));
    } else {
      children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, indent: { firstLine: 567 }, spacing: { after: 60 }, children: [run(line)] }));
    }
  }

  const doc = new Document({
    creator: 'Phần mềm quản lý, đánh giá KPI/OKR – Ban Tổ chức Tỉnh ủy Đắk Lắk',
    title: draft.title,
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run('DỰ THẢO – chưa ban hành', { italics: true, size: 20, color: '888888' })] })] }) },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
