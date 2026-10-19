import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import pdfmake from 'pdfmake';
import { formatNumber, formatPercent } from '../application/draft-templates.js';
import { RATING_LABELS, RATINGS, STATUS_LABELS } from '../application/report.model.js';
import type { PeriodReport, Stats, UnitReport } from '../application/report.model.js';
import { ReportRenderer } from '../application/report.ports.js';
import { renderDraftDocx } from './draft-docx.js';

const FONT_DIR = join(dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')), 'fonts', 'Roboto');
const GENERATOR = 'Phần mềm quản lý, đánh giá KPI/OKR – Ban Tổ chức Tỉnh ủy Đắk Lắk';

/** Tiêu đề kỳ dạng chữ: "2026-Q3 (2026-07-01 đến 2026-09-30)". */
const periodText = (r: PeriodReport) => `${r.period.label} (${r.period.startDate} đến ${r.period.endDate})`;

/**
 * Xuất báo cáo ra Excel (exceljs) và PDF (pdfmake, phông Roboto có đủ dấu tiếng Việt) (ADR-015 mục 6).
 * Chỉ xuất họ tên, đơn vị, chức vụ, điểm, xếp loại; không có nhận xét hay minh chứng.
 */
@Injectable()
export class FileReportRenderer extends ReportRenderer {
  renderDraftDocx = renderDraftDocx;

  constructor() {
    super();
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
  }

  async renderExcel(report: PeriodReport): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = GENERATOR;
    wb.created = report.generatedAt;

    const summary = wb.addWorksheet('Tổng hợp');
    summary.columns = [{ width: 38 }, ...Array.from({ length: 11 }, () => ({ width: 15 }))];
    const bold = (row: ExcelJS.Row) => (row.font = { bold: true });

    bold(summary.addRow(['BÁO CÁO KẾT QUẢ ĐÁNH GIÁ, XẾP LOẠI CHẤT LƯỢNG']));
    summary.addRow(['Kỳ', periodText(report)]);
    summary.addRow(['Trạng thái kỳ', report.period.status === 'OPEN' ? 'Đang mở' : 'Đã đóng']);
    summary.addRow(['Phạm vi dữ liệu', report.scope === 'ALL' ? 'Toàn bộ hồ sơ của kỳ' : 'Chỉ các hồ sơ trong phạm vi của người xuất']);
    summary.addRow(['Thời điểm lập', report.generatedAt.toISOString()]);
    summary.addRow([]);

    bold(summary.addRow(['Tổng hợp chung']));
    const o = report.overall;
    summary.addRow(['Tổng số hồ sơ', o.evaluations]);
    summary.addRow(['Đã phê duyệt', o.approved]);
    summary.addRow(['Chờ phê duyệt', o.pendingApproval]);
    summary.addRow(['Đang thực hiện', o.inProgress]);
    summary.addRow(['Tỷ lệ hoàn tất', o.completionRate]).getCell(2).numFmt = '0.0%';
    summary.addRow(['Điểm trung bình (đã phê duyệt)', o.averageTotal]).getCell(2).numFmt = '0.00';
    summary.addRow(['Điểm thấp nhất', o.minTotal]);
    summary.addRow(['Điểm cao nhất', o.maxTotal]);
    summary.addRow([]);

    bold(summary.addRow(['Phân bố xếp loại (đã phê duyệt)', 'Số người']));
    for (const r of RATINGS) summary.addRow([RATING_LABELS[r], o.ratings[r]]);
    summary.addRow(['Mức xuất sắc tối đa tham khảo (20% số hoàn thành tốt)', o.excellentQuota.allowed]);
    summary.addRow([]);

    bold(
      summary.addRow([
        'Theo đơn vị', 'Số hồ sơ', 'Đã phê duyệt', 'Chờ phê duyệt', 'Đang thực hiện', 'Điểm TB', 'Thấp nhất', 'Cao nhất',
        'Xuất sắc', 'Hoàn thành tốt', 'Hoàn thành', 'Không hoàn thành',
      ]),
    );
    for (const u of report.byUnit) {
      const row = summary.addRow([
        u.unitName, u.evaluations, u.approved, u.pendingApproval, u.inProgress, u.averageTotal, u.minTotal, u.maxTotal,
        u.ratings.XUAT_SAC, u.ratings.HOAN_THANH_TOT, u.ratings.HOAN_THANH, u.ratings.KHONG_HOAN_THANH,
      ]);
      row.getCell(6).numFmt = '0.00';
    }
    summary.addRow([]);
    bold(summary.addRow(['Lưu ý']));
    for (const note of report.notes) summary.addRow([note]);

    const detail = wb.addWorksheet('Chi tiết');
    detail.columns = [
      { header: 'STT', width: 6 },
      { header: 'Họ và tên', width: 30 },
      { header: 'Đơn vị', width: 32 },
      { header: 'Chức vụ', width: 28 },
      { header: 'Trạng thái', width: 34 },
      { header: 'Điểm tiêu chí chung', width: 14 },
      { header: 'Điểm kết quả nhiệm vụ', width: 14 },
      { header: 'Tổng điểm', width: 12 },
      { header: 'Xếp loại', width: 28 },
    ];
    detail.getRow(1).font = { bold: true };
    detail.views = [{ state: 'frozen', ySplit: 1 }];
    report.rows.forEach((r, i) => {
      detail.addRow([
        i + 1, r.fullName, r.unitName, r.positionTitle, STATUS_LABELS[r.status],
        r.generalScore, r.resultScore, r.totalScore, r.rating ? RATING_LABELS[r.rating] : null,
      ]);
    });
    for (const col of [6, 7, 8]) detail.getColumn(col).numFmt = '0.00';

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async renderUnitExcel(report: UnitReport): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = GENERATOR;
    wb.created = report.generatedAt;
    const ws = wb.addWorksheet('Tập thể');
    ws.columns = [{ width: 6 }, { width: 36 }, { width: 28 }, { width: 34 }, { width: 14 }, { width: 14 }, { width: 12 }, { width: 28 }, { width: 12 }];
    const bold = (row: ExcelJS.Row) => (row.font = { bold: true });
    bold(ws.addRow(['BÁO CÁO KẾT QUẢ ĐÁNH GIÁ, XẾP LOẠI CHẤT LƯỢNG TẬP THỂ']));
    ws.addRow(['Kỳ', `Năm ${report.period.label} (${report.period.startDate} đến ${report.period.endDate})`]);
    ws.addRow(['Phạm vi dữ liệu', report.scope === 'ALL' ? 'Toàn bộ hồ sơ của kỳ' : 'Chỉ các hồ sơ trong phạm vi của người xuất']);
    ws.addRow(['Thời điểm lập', report.generatedAt.toISOString()]);
    ws.addRow([]);
    bold(ws.addRow(['Tổng hợp']));
    ws.addRow(['Tổng số tập thể', report.units]);
    ws.addRow(['Đã phê duyệt', report.approved]);
    ws.addRow(['Chờ phê duyệt', report.pendingApproval]);
    ws.addRow(['Đang thực hiện', report.inProgress]);
    ws.addRow(['Điểm trung bình (đã phê duyệt)', report.averageTotal]).getCell(2).numFmt = '0.00';
    for (const r of RATINGS) ws.addRow([RATING_LABELS[r], report.ratings[r]]);
    ws.addRow(['Hạn mức xuất sắc tối đa (20% số tập thể hoàn thành tốt)', report.quota.allowed]);
    ws.addRow([]);
    bold(ws.addRow(['STT', 'Tập thể', 'Người đứng đầu', 'Trạng thái', 'Điểm tiêu chí chung', 'Điểm kết quả nhiệm vụ', 'Tổng điểm', 'Xếp loại', 'Cảnh báo']));
    report.rows.forEach((r, i) => {
      const row = ws.addRow([
        i + 1, r.unitName, r.headName, STATUS_LABELS[r.status], r.generalScore, r.resultScore, r.totalScore,
        r.rating ? RATING_LABELS[r.rating] : null, r.warnings > 0 ? r.warnings : null,
      ]);
      for (const c of [5, 6, 7]) row.getCell(c).numFmt = '0.00';
    });
    ws.addRow([]);
    bold(ws.addRow(['Lưu ý']));
    for (const note of report.notes) ws.addRow([note]);

    if (report.axisSummary.length > 0) this.addAxisSheet(wb, report);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /** Trang "Theo trục": mỗi hồ sơ đã phê duyệt một dòng, mỗi trục một cột, kèm dòng trung bình (ADR-037). */
  private addAxisSheet(wb: ExcelJS.Workbook, report: UnitReport): void {
    const sheet = wb.addWorksheet('Theo trục');
    const axes = report.axisSummary;
    sheet.columns = [{ width: 6 }, { width: 34 }, ...axes.map(() => ({ width: 18 })), { width: 12 }];
    sheet.addRow(['BÁO CÁO ĐIỂM TẬP THỂ THEO TRỤC']).font = { bold: true };
    sheet.addRow(['Kỳ', `Năm ${report.period.label}`]);
    sheet.addRow(['Chỉ tính hồ sơ đã phê duyệt có chấm theo trục; điểm tối đa lấy theo cấu hình lúc chấm.']);
    sheet.addRow([]);
    const head = sheet.addRow(['STT', 'Tập thể', ...axes.map((a) => `${a.code} ${a.name} (tối đa ${a.maxPoints})`), 'Tổng điểm']);
    head.font = { bold: true };
    head.alignment = { wrapText: true, vertical: 'top' };
    const approved = report.rows.filter((r) => r.status === 'APPROVED' && r.axes.length > 0);
    approved.forEach((r, i) => {
      const row = sheet.addRow([i + 1, r.unitName, ...axes.map((a) => r.axes.find((x) => x.code === a.code)?.points ?? null), r.totalScore]);
      for (let c = 3; c < 4 + axes.length; c++) row.getCell(c).numFmt = '0.00';
    });
    const avg = sheet.addRow(['', 'Trung bình', ...axes.map((a) => a.average), null]);
    avg.font = { bold: true };
    const pct = sheet.addRow(['', 'Tỷ lệ trên điểm tối đa', ...axes.map((a) => a.ratio), null]);
    for (let c = 3; c < 3 + axes.length; c++) {
      avg.getCell(c).numFmt = '0.00';
      pct.getCell(c).numFmt = '0%';
    }
    sheet.addRow(['', 'Thấp nhất', ...axes.map((a) => a.lowest), null]);
  }

  async renderPdf(report: PeriodReport): Promise<Buffer> {
    const o = report.overall;
    const num = (n: number | null) => formatNumber(n);
    const statsRow = (label: string, s: Stats) => [
      label, s.evaluations, s.approved, s.pendingApproval + s.inProgress, num(s.averageTotal),
      s.ratings.XUAT_SAC, s.ratings.HOAN_THANH_TOT, s.ratings.HOAN_THANH, s.ratings.KHONG_HOAN_THANH,
    ];

    const document = pdfmake.createPdf({
      pageOrientation: 'landscape',
      pageMargins: [36, 36, 36, 40],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      styles: { title: { fontSize: 14, bold: true, margin: [0, 0, 0, 6] }, h2: { fontSize: 11, bold: true, margin: [0, 10, 0, 4] } },
      content: [
        { text: 'BÁO CÁO KẾT QUẢ ĐÁNH GIÁ, XẾP LOẠI CHẤT LƯỢNG', style: 'title' },
        { text: `Ban Tổ chức Tỉnh ủy Đắk Lắk – kỳ ${periodText(report)}` },
        { text: `Phạm vi: ${report.scope === 'ALL' ? 'toàn bộ hồ sơ của kỳ' : 'chỉ các hồ sơ trong phạm vi của người xuất'}. Lập lúc ${report.generatedAt.toISOString()}.`, italics: true },

        { text: 'Tổng hợp chung', style: 'h2' },
        {
          table: {
            widths: [220, 70],
            body: [
              ['Tổng số hồ sơ', String(o.evaluations)],
              ['Đã phê duyệt', String(o.approved)],
              ['Chờ phê duyệt', String(o.pendingApproval)],
              ['Đang thực hiện', String(o.inProgress)],
              ['Tỷ lệ hoàn tất', formatPercent(o.completionRate)],
              ['Điểm trung bình (đã phê duyệt)', num(o.averageTotal)],
              ['Điểm thấp nhất / cao nhất', `${num(o.minTotal)} / ${num(o.maxTotal)}`],
              ...RATINGS.map((r) => [RATING_LABELS[r], String(o.ratings[r])]),
              ['Mức xuất sắc tối đa tham khảo (20% số hoàn thành tốt)', String(o.excellentQuota.allowed)],
            ],
          },
        },

        { text: 'Theo đơn vị', style: 'h2' },
        {
          table: {
            headerRows: 1,
            widths: ['*', 40, 55, 70, 50, 45, 55, 55, 70],
            body: [
              [
                { text: 'Đơn vị', bold: true }, { text: 'Hồ sơ', bold: true }, { text: 'Đã duyệt', bold: true },
                { text: 'Chưa duyệt', bold: true }, { text: 'Điểm TB', bold: true }, { text: 'Xuất sắc', bold: true },
                { text: 'Tốt', bold: true }, { text: 'Hoàn thành', bold: true }, { text: 'Không HT', bold: true },
              ],
              ...report.byUnit.map((u) => statsRow(u.unitName, u).map(String)),
            ],
          },
        },

        { text: 'Chi tiết từng hồ sơ', style: 'h2' },
        {
          table: {
            headerRows: 1,
            widths: [22, 110, 110, 90, 125, 40, 40, 40, '*'], // cột trạng thái đủ rộng để cụm chữ không bị ngắt dòng
            body: [
              ['STT', 'Họ và tên', 'Đơn vị', 'Chức vụ', 'Trạng thái', 'Chung', 'Kết quả', 'Tổng', 'Xếp loại'].map((t) => ({ text: t, bold: true })),
              ...report.rows.map((r, i) => [
                String(i + 1), r.fullName, r.unitName, r.positionTitle, STATUS_LABELS[r.status],
                num(r.generalScore), num(r.resultScore), num(r.totalScore), r.rating ? RATING_LABELS[r.rating] : '–',
              ]),
            ],
          },
        },

        { text: 'Lưu ý', style: 'h2' },
        { ul: report.notes },
      ],
      footer: (currentPage: number, pageCount: number) => ({
        text: `${GENERATOR} – trang ${currentPage}/${pageCount}`,
        alignment: 'center',
        fontSize: 7,
        color: '#666666',
      }),
    });
    return Buffer.from(await document.getBuffer());
  }
}
