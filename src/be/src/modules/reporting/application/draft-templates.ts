import { RATING_LABELS, RATINGS } from './report.model.js';
import type { PeriodReport, ReportRow, Stats } from './report.model.js';

export type DraftKind = 'REPORT' | 'DECISION';

export interface Draft {
  kind: DraftKind;
  title: string;
  body: string;
  disclaimer: string;
  /** Số hồ sơ đã phê duyệt đưa vào dự thảo. */
  approvedCount: number;
}

export const DRAFT_DISCLAIMER =
  'DỰ THẢO, chỉ để tham khảo. Số, ngày, người ký, nhận định và thể thức văn bản cần người có thẩm quyền hoàn thiện theo mẫu chính thức của cơ quan; không dùng nguyên văn khi chưa rà soát.';

const BLANK = '…';
const PLACEHOLDER = '[Cần bổ sung]';

const LEGAL_BASIS = [
  'Căn cứ Quy định số 39-QĐ/TU, ngày 28/11/2025 của Ban Thường vụ Tỉnh ủy Đắk Lắk về kiểm điểm và đánh giá, xếp loại chất lượng đối với tập thể, cá nhân trong hệ thống chính trị tỉnh;',
  'Căn cứ Hướng dẫn số 05-HD/TU, ngày 16/6/2026 của Ban Thường vụ Tỉnh ủy Đắk Lắk về đánh giá, xếp loại chất lượng định kỳ hằng quý đối với cán bộ lãnh đạo, quản lý các cấp trong hệ thống chính trị tỉnh;',
];

/** Số theo kiểu Việt Nam: dấu phẩy thập phân. */
export const formatNumber = (n: number | null, digits = 2): string => (n === null ? '–' : n.toFixed(digits).replace('.', ','));
export const formatPercent = (ratio: number | null): string => (ratio === null ? '–' : `${formatNumber(ratio * 100, 1)}%`);

function periodTitle(report: PeriodReport): string {
  const { label, startDate, endDate } = report.period;
  return `kỳ ${label} (từ ${startDate} đến ${endDate})`;
}

function ratingLines(stats: Stats): string[] {
  const approved = stats.approved;
  return RATINGS.map((r) => {
    const n = stats.ratings[r];
    return `- ${RATING_LABELS[r]}: ${n} người${approved > 0 ? ` (${formatPercent(n / approved)})` : ''}`;
  });
}

function reportDraft(report: PeriodReport): Draft {
  const o = report.overall;
  const lines: string[] = [
    'BAN TỔ CHỨC TỈNH ỦY ĐẮK LẮK                 ĐẢNG CỘNG SẢN VIỆT NAM',
    `Số: ${BLANK}-BC/BTCTU                        Đắk Lắk, ngày ${BLANK} tháng ${BLANK} năm ${BLANK}`,
    '',
    'BÁO CÁO',
    `Kết quả đánh giá, xếp loại chất lượng cán bộ, công chức ${periodTitle(report)}`,
    '',
    ...LEGAL_BASIS,
    'Ban Tổ chức Tỉnh ủy báo cáo kết quả như sau:',
    '',
    'I. TÌNH HÌNH CHUNG',
    `- Tổng số hồ sơ đánh giá: ${o.evaluations}; đã phê duyệt: ${o.approved} (tỷ lệ hoàn tất ${formatPercent(o.completionRate)}); chờ phê duyệt: ${o.pendingApproval}; đang thực hiện: ${o.inProgress}.`,
    '',
    'II. KẾT QUẢ XẾP LOẠI (tính trên các hồ sơ đã phê duyệt)',
    ...ratingLines(o),
    `- Điểm trung bình: ${formatNumber(o.averageTotal)}; thấp nhất: ${formatNumber(o.minTotal)}; cao nhất: ${formatNumber(o.maxTotal)}.`,
    '',
    'III. KẾT QUẢ THEO ĐƠN VỊ',
    ...report.byUnit.map(
      (u, i) =>
        `${i + 1}. ${u.unitName}: ${u.approved}/${u.evaluations} hồ sơ đã phê duyệt; điểm trung bình ${formatNumber(u.averageTotal)}; xuất sắc ${u.ratings.XUAT_SAC}, tốt ${u.ratings.HOAN_THANH_TOT}, hoàn thành ${u.ratings.HOAN_THANH}, không hoàn thành ${u.ratings.KHONG_HOAN_THANH}.`,
    ),
  ];
  if (report.byUnit.length === 0) lines.push('(Chưa có hồ sơ đánh giá trong kỳ.)');
  lines.push('', 'IV. ƯU ĐIỂM, HẠN CHẾ VÀ KIẾN NGHỊ', `${PLACEHOLDER} Nhận định của người lập báo cáo.`);

  if (o.excellentQuota.exceeded) {
    lines.push(
      '',
      `Lưu ý: số xuất sắc (${o.excellentQuota.excellent}) vượt mức tham khảo ${o.excellentQuota.allowed} (20% số hoàn thành tốt); cần xem xét theo quy định trước khi ban hành.`,
    );
  }
  lines.push('', `Nơi nhận: ${BLANK}`, '', '                                            TRƯỞNG BAN', `                                            ${BLANK}`);

  return {
    kind: 'REPORT',
    title: `Dự thảo báo cáo kết quả đánh giá, xếp loại ${periodTitle(report)}`,
    body: lines.join('\n'),
    disclaimer: DRAFT_DISCLAIMER,
    approvedCount: o.approved,
  };
}

function decisionDraft(report: PeriodReport): Draft {
  const approved: ReportRow[] = report.rows.filter((r) => r.status === 'APPROVED' && r.rating !== null);
  const lines: string[] = [
    'BAN TỔ CHỨC TỈNH ỦY ĐẮK LẮK                 ĐẢNG CỘNG SẢN VIỆT NAM',
    `Số: ${BLANK}-QĐ/BTCTU                        Đắk Lắk, ngày ${BLANK} tháng ${BLANK} năm ${BLANK}`,
    '',
    'QUYẾT ĐỊNH',
    `Về việc công nhận kết quả đánh giá, xếp loại chất lượng cán bộ, công chức ${periodTitle(report)}`,
    '',
    'TRƯỞNG BAN TỔ CHỨC TỈNH ỦY',
    ...LEGAL_BASIS,
    'Căn cứ kết quả đánh giá, xếp loại đã được cấp có thẩm quyền phê duyệt;',
    '',
    'QUYẾT ĐỊNH:',
    `Điều 1. Công nhận kết quả đánh giá, xếp loại chất lượng ${periodTitle(report)} đối với ${approved.length} cán bộ, công chức có tên sau đây:`,
    ...approved.map(
      (r, i) =>
        `${i + 1}. ${r.fullName} – ${r.positionTitle} (${r.unitName}): ${formatNumber(r.totalScore)} điểm, ${RATING_LABELS[r.rating!]}.`,
    ),
  ];
  if (approved.length === 0) lines.push('(Chưa có hồ sơ nào được phê duyệt trong kỳ.)');
  lines.push(
    'Điều 2. Các phòng thuộc Ban, các cán bộ, công chức có tên tại Điều 1 chịu trách nhiệm thi hành Quyết định này.',
    'Điều 3. Quyết định này có hiệu lực kể từ ngày ký.',
    '',
    `Nơi nhận: ${BLANK}`,
    '',
    '                                            TRƯỞNG BAN',
    `                                            ${BLANK}`,
  );

  return {
    kind: 'DECISION',
    title: `Dự thảo quyết định công nhận kết quả đánh giá, xếp loại ${periodTitle(report)}`,
    body: lines.join('\n'),
    disclaimer: DRAFT_DISCLAIMER,
    approvedCount: approved.length,
  };
}

/** Dự thảo điền mẫu từ báo cáo. Không dùng AI; chỉ chiếu số liệu và danh sách có sẵn vào khung văn bản (ADR-015 mục 7). */
export function buildDraft(kind: DraftKind, report: PeriodReport): Draft {
  return kind === 'REPORT' ? reportDraft(report) : decisionDraft(report);
}
