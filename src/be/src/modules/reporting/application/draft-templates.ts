import { RATING_LABELS, RATINGS } from './report.model.js';
import type { PeriodReport, ReportRow, Stats, UnitReport } from './report.model.js';

/** REPORT: báo cáo kết quả; DECISION: quyết định công nhận xếp loại; NOTICE: thông báo kết quả gửi các phòng. */
export type DraftKind = 'REPORT' | 'DECISION' | 'NOTICE';
export const DRAFT_KINDS: readonly DraftKind[] = ['REPORT', 'DECISION', 'NOTICE'];

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
  if (report.period.type === 'YEAR') {
    const notRated = report.rows.filter((r) => r.status === 'APPROVED' && r.rating === null).length;
    lines.push(
      '',
      'V. GHI CHÚ VỀ ĐIỂM NĂM',
      '- Điểm năm là trung bình cộng điểm các tháng đã được phê duyệt trong năm (Nghị định 335/2025/NĐ-CP Điều 17.3); cán bộ kiêm nhiệm có kết quả riêng cho từng vị trí.',
      `- Số hồ sơ đóng là "không xếp loại" do chưa đủ 6 tháng công tác trong năm (Điều 11.1): ${notRated}.`,
    );
  }

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

/**
 * Thông báo kết quả gửi các phòng: số liệu chung và theo đơn vị, không nêu tên từng cán bộ (tên và điểm nằm ở quyết định công nhận).
 */
function noticeDraft(report: PeriodReport): Draft {
  const o = report.overall;
  const lines: string[] = [
    'BAN TỔ CHỨC TỈNH ỦY ĐẮK LẮK                 ĐẢNG CỘNG SẢN VIỆT NAM',
    `Số: ${BLANK}-TB/BTCTU                        Đắk Lắk, ngày ${BLANK} tháng ${BLANK} năm ${BLANK}`,
    '',
    'THÔNG BÁO',
    `Kết quả đánh giá, xếp loại chất lượng cán bộ, công chức ${periodTitle(report)}`,
    '',
    ...LEGAL_BASIS,
    `Căn cứ Quyết định số ${BLANK}-QĐ/BTCTU, ngày ${BLANK} của Trưởng Ban Tổ chức Tỉnh ủy về việc công nhận kết quả đánh giá, xếp loại chất lượng ${periodTitle(report)};`,
    'Ban Tổ chức Tỉnh ủy thông báo kết quả như sau:',
    '',
    'I. KẾT QUẢ CHUNG',
    `- Đã phê duyệt ${o.approved}/${o.evaluations} hồ sơ (${formatPercent(o.completionRate)}); điểm trung bình ${formatNumber(o.averageTotal)}.`,
    ...ratingLines(o),
    '',
    'II. KẾT QUẢ THEO ĐƠN VỊ',
    ...report.byUnit.map(
      (u, i) =>
        `${i + 1}. ${u.unitName}: ${u.approved}/${u.evaluations} hồ sơ đã phê duyệt; xuất sắc ${u.ratings.XUAT_SAC}, tốt ${u.ratings.HOAN_THANH_TOT}, hoàn thành ${u.ratings.HOAN_THANH}, không hoàn thành ${u.ratings.KHONG_HOAN_THANH}.`,
    ),
  ];
  if (report.byUnit.length === 0) lines.push('(Chưa có hồ sơ đánh giá trong kỳ.)');
  lines.push(
    '',
    'III. TỔ CHỨC THỰC HIỆN',
    '- Các phòng thông báo kết quả đến từng cán bộ, công chức thuộc phòng mình.',
    `- Ý kiến phản ánh, đề nghị xem xét lại (nếu có) gửi về Ban Tổ chức Tỉnh ủy trước ngày ${BLANK} tháng ${BLANK} năm ${BLANK}.`,
    '',
    `Nơi nhận: ${BLANK}`,
    '',
    '                                            TRƯỞNG BAN',
    `                                            ${BLANK}`,
  );
  return {
    kind: 'NOTICE',
    title: `Dự thảo thông báo kết quả đánh giá, xếp loại ${periodTitle(report)}`,
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
  return kind === 'REPORT' ? reportDraft(report) : kind === 'NOTICE' ? noticeDraft(report) : decisionDraft(report);
}

const UNIT_LEGAL_BASIS = [
  'Căn cứ Nghị định số 335/2025/NĐ-CP, ngày 21/12/2025 của Chính phủ quy định về đánh giá, xếp loại chất lượng đối với cơ quan hành chính nhà nước và công chức;',
  LEGAL_BASIS[0],
];

/**
 * Dự thảo quyết định công nhận kết quả xếp loại tập thể theo năm (ADR-031). Chỉ liệt kê đơn vị đã phê duyệt;
 * điền mẫu, không dùng AI, người có thẩm quyền hoàn thiện (ADR-015 mục 7).
 */
export function buildUnitDecisionDraft(report: UnitReport): Draft {
  const approved = report.rows.filter((r) => r.status === 'APPROVED' && r.rating !== null);
  const year = `năm ${report.period.label}`;
  const lines: string[] = [
    'BAN TỔ CHỨC TỈNH ỦY ĐẮK LẮK                 ĐẢNG CỘNG SẢN VIỆT NAM',
    `Số: ${BLANK}-QĐ/BTCTU                        Đắk Lắk, ngày ${BLANK} tháng ${BLANK} năm ${BLANK}`,
    '',
    'QUYẾT ĐỊNH',
    `Về việc công nhận kết quả đánh giá, xếp loại chất lượng tập thể ${year}`,
    '',
    'TRƯỞNG BAN TỔ CHỨC TỈNH ỦY',
    ...UNIT_LEGAL_BASIS,
    'Căn cứ kết quả tự đánh giá, thẩm định của các đơn vị thuộc Ban;',
    '',
    'QUYẾT ĐỊNH:',
    `Điều 1. Công nhận kết quả đánh giá, xếp loại chất lượng ${year} đối với ${approved.length} tập thể có tên sau đây:`,
    ...approved.map((r, i) => `${i + 1}. ${r.unitName}: ${formatNumber(r.totalScore)} điểm, ${RATING_LABELS[r.rating!]}.`),
  ];
  if (approved.length === 0) lines.push('(Chưa có tập thể nào được phê duyệt trong kỳ.)');
  lines.push(
    'Điều 2. Các phòng thuộc Ban chịu trách nhiệm thi hành Quyết định này.',
    'Điều 3. Quyết định này có hiệu lực kể từ ngày ký.',
  );
  if (report.quota.exceeded) {
    lines.push('', `Lưu ý: số tập thể xuất sắc (${report.quota.excellent}) vượt hạn mức 20% số tập thể hoàn thành tốt (${report.quota.good}); cần xem xét theo quy định trước khi ban hành.`);
  }
  lines.push('', `Nơi nhận: ${BLANK}`, '', '                                            TRƯỞNG BAN', `                                            ${BLANK}`);

  return {
    kind: 'DECISION',
    title: `Dự thảo quyết định công nhận kết quả xếp loại tập thể ${year}`,
    body: lines.join('\n'),
    disclaimer: DRAFT_DISCLAIMER,
    approvedCount: approved.length,
  };
}
