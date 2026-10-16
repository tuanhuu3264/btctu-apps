import { RATINGS } from './report.model.js';
import type { AxisSummary, RatingCounts, ReportPeriod, UnitQuota, UnitReport, UnitReportRow } from './report.model.js';

/** Hạn mức xuất sắc của tập thể: không quá 20% số tổ chức hoàn thành tốt (Nghị định 335 Điều 8.5.a). */
export const UNIT_EXCELLENT_RATIO = 0.2;

const round2 = (n: number) => Math.round(n * 100) / 100;

export function unitQuota(ratings: RatingCounts): UnitQuota {
  const allowed = round2(ratings.HOAN_THANH_TOT * UNIT_EXCELLENT_RATIO);
  // So sánh bằng số nguyên để tránh sai số dấu phẩy động: xuất sắc * 5 > tốt.
  return { excellent: ratings.XUAT_SAC, good: ratings.HOAN_THANH_TOT, allowed, exceeded: ratings.XUAT_SAC * 5 > ratings.HOAN_THANH_TOT };
}

/**
 * Trung bình từng trục trên các hồ sơ đã phê duyệt. Trục nhận diện theo mã; tên và điểm tối đa lấy từ ảnh chụp mới nhất
 * nên khi cấu hình đổi giữa chừng vẫn so sánh được theo tỷ lệ (ADR-037).
 */
export function summarizeAxes(rows: readonly UnitReportRow[]): AxisSummary[] {
  const byCode = new Map<string, { head: UnitReportRow['axes'][number]; values: number[]; ratios: number[] }>();
  for (const r of rows) {
    if (r.status !== 'APPROVED') continue;
    for (const a of r.axes) {
      const entry = byCode.get(a.code) ?? { head: a, values: [], ratios: [] };
      entry.values.push(a.points);
      entry.ratios.push(a.maxPoints > 0 ? a.points / a.maxPoints : 0);
      byCode.set(a.code, entry);
    }
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return [...byCode.values()]
    .map(({ head, values, ratios }) => ({
      code: head.code,
      name: head.name,
      kind: head.kind,
      maxPoints: head.maxPoints,
      count: values.length,
      average: round2(mean(values)),
      ratio: Math.round(mean(ratios) * 10000) / 10000,
      lowest: Math.min(...values),
    }))
    .sort((a, b) => Number(b.kind === 'GENERAL') - Number(a.kind === 'GENERAL') || a.code.localeCompare(b.code));
}

export interface BuildUnitReportInput {
  period: ReportPeriod;
  rows: readonly UnitReportRow[];
  scope: 'ALL' | 'LIMITED';
  generatedAt: Date;
}

/** Dựng báo cáo tập thể của một kỳ năm. Hàm thuần. Điểm và xếp loại chỉ tính trên hồ sơ đã phê duyệt. */
export function buildUnitReport(input: BuildUnitReportInput): UnitReport {
  // Ban đứng đầu, rồi các đơn vị theo tên.
  const rows = [...input.rows].sort((a, b) => Number(b.unitType === 'BAN') - Number(a.unitType === 'BAN') || a.unitName.localeCompare(b.unitName, 'vi'));
  const approved = rows.filter((r) => r.status === 'APPROVED' && r.totalScore !== null);
  const ratings: RatingCounts = { XUAT_SAC: 0, HOAN_THANH_TOT: 0, HOAN_THANH: 0, KHONG_HOAN_THANH: 0 };
  for (const r of approved) if (r.rating) ratings[r.rating]++;
  const totals = approved.map((r) => r.totalScore as number);
  const quota = unitQuota(ratings);
  const pendingApproval = rows.filter((r) => r.status === 'REVIEWED').length;
  const inProgress = rows.filter((r) => r.status === 'PLANNED' || r.status === 'SELF_SUBMITTED').length;

  const notes: string[] = [
    'Điểm tập thể do người thẩm định chấm (30 điểm chung và 70 điểm kết quả), không suy từ điểm cá nhân. Hồ sơ chấm theo trục có điểm từng trục; phân bổ trục là đề xuất, cấp tỉnh quy định chi tiết (Nghị định 335/2025/NĐ-CP Điều 7.2).',
    'Xếp loại ở đây theo ngưỡng điểm 90/70/50; điều kiện của Điều 8 chỉ được cảnh báo ở từng hồ sơ, không tự áp dụng.',
  ];
  if (input.scope === 'LIMITED') notes.push('Báo cáo chỉ gồm các hồ sơ nằm trong phạm vi của bạn, không phải toàn bộ hồ sơ của kỳ.');
  if (quota.exceeded) {
    notes.push(
      `Số đơn vị xuất sắc (${quota.excellent}) vượt hạn mức 20% số đơn vị hoàn thành tốt (${quota.good}); cấp có thẩm quyền được quyết định tới 25% với đơn vị nổi trội. Chưa tính ngoại lệ khi có ít đối tượng.`,
    );
  }
  if (pendingApproval + inProgress > 0) {
    notes.push(`Còn ${pendingApproval + inProgress} hồ sơ chưa phê duyệt (${pendingApproval} chờ phê duyệt, ${inProgress} đang thực hiện); số liệu điểm chỉ tính các hồ sơ đã phê duyệt.`);
  }
  if (rows.some((r) => r.warnings > 0)) notes.push('Có hồ sơ còn cảnh báo điều kiện xếp loại, xem chi tiết ở từng hồ sơ.');

  return {
    period: input.period,
    scope: input.scope,
    generatedAt: input.generatedAt,
    units: rows.length,
    approved: approved.length,
    pendingApproval,
    inProgress,
    ratings,
    averageTotal: totals.length === 0 ? null : round2(totals.reduce((a, b) => a + b, 0) / totals.length),
    quota,
    axisSummary: summarizeAxes(rows),
    rows,
    notes,
  };
}

export { RATINGS };
