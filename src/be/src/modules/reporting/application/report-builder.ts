import { RATINGS } from './report.model.js';
import type {
  ExcellentQuota,
  PeriodReport,
  RatingCounts,
  ReportPeriod,
  ReportRow,
  Stats,
  UnitStats,
} from './report.model.js';

/** Hạn mức xuất sắc: không quá 20% số hoàn thành tốt (39-QĐ/TU Điều 11 khoản 1.5). */
export const EXCELLENT_QUOTA_RATIO = 0.2;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
/** Làm tròn từ 0,5 trở lên thành 1 (05-HD/TU mục 8.2). Cộng thêm số rất nhỏ để tránh sai số dấu phẩy động (0,1 + 0,2…). */
const roundHalfUp = (n: number) => Math.floor(n + 0.5 + 1e-9);

const emptyRatings = (): RatingCounts => ({ XUAT_SAC: 0, HOAN_THANH_TOT: 0, HOAN_THANH: 0, KHONG_HOAN_THANH: 0 });

export function excellentQuota(ratings: RatingCounts): ExcellentQuota {
  const allowed = roundHalfUp(ratings.HOAN_THANH_TOT * EXCELLENT_QUOTA_RATIO);
  return { excellent: ratings.XUAT_SAC, good: ratings.HOAN_THANH_TOT, allowed, exceeded: ratings.XUAT_SAC > allowed };
}

/** Thống kê một nhóm hồ sơ. Điểm và xếp loại chỉ tính trên hồ sơ đã phê duyệt (ADR-015 mục 3). */
export function computeStats(rows: readonly ReportRow[]): Stats {
  const approved = rows.filter((r) => r.status === 'APPROVED' && r.totalScore !== null);
  const totals = approved.map((r) => r.totalScore as number);
  const ratings = emptyRatings();
  for (const r of approved) if (r.rating) ratings[r.rating]++;

  return {
    evaluations: rows.length,
    approved: approved.length,
    pendingApproval: rows.filter((r) => r.status === 'REVIEWED').length,
    inProgress: rows.filter((r) => r.status === 'PLANNED' || r.status === 'SELF_SUBMITTED').length,
    completionRate: rows.length === 0 ? null : round4(approved.length / rows.length), // giữ 4 chữ số để hiển thị phần trăm 1 chữ số thập phân đúng
    averageTotal: totals.length === 0 ? null : round2(totals.reduce((a, b) => a + b, 0) / totals.length),
    minTotal: totals.length === 0 ? null : Math.min(...totals),
    maxTotal: totals.length === 0 ? null : Math.max(...totals),
    ratings,
    excellentQuota: excellentQuota(ratings),
  };
}

export function sortRows(rows: readonly ReportRow[]): ReportRow[] {
  return [...rows].sort(
    (a, b) =>
      a.unitName.localeCompare(b.unitName, 'vi') || a.level - b.level || a.fullName.localeCompare(b.fullName, 'vi'),
  );
}

export interface BuildReportInput {
  period: ReportPeriod;
  rows: readonly ReportRow[];
  scope: 'ALL' | 'LIMITED';
  generatedAt: Date;
  /** Nhãn chính sách điểm đã dùng khi thẩm định, nếu có. */
  policyVersions: readonly string[];
}

/** Dựng báo cáo kỳ từ các hồ sơ đã ghép thông tin. Hàm thuần, không đọc dữ liệu ngoài. */
export function buildPeriodReport(input: BuildReportInput): PeriodReport {
  const rows = sortRows(input.rows);
  const overall = computeStats(rows);

  const byUnitMap = new Map<string, ReportRow[]>();
  for (const r of rows) byUnitMap.set(r.unitCode, [...(byUnitMap.get(r.unitCode) ?? []), r]);
  const byUnit: UnitStats[] = [...byUnitMap.entries()]
    .map(([unitCode, unitRows]) => ({ unitCode, unitName: unitRows[0].unitName, ...computeStats(unitRows) }))
    .sort((a, b) => a.unitName.localeCompare(b.unitName, 'vi'));

  const notes: string[] = [];
  if (input.scope === 'LIMITED') {
    notes.push('Báo cáo chỉ gồm các hồ sơ nằm trong phạm vi của bạn, không phải toàn bộ hồ sơ của kỳ.');
  }
  if (input.policyVersions.length > 0) {
    notes.push(`Điểm tính theo chính sách ${input.policyVersions.join(', ')} (giả định, chưa được Ban xác nhận).`);
  }
  notes.push('Xếp loại ở đây chỉ theo ngưỡng điểm 90/70/50; chưa áp dụng điều kiện kèm theo, trường hợp loại trừ và hạn mức xuất sắc.');
  if (overall.excellentQuota.exceeded) {
    notes.push(
      `Số xuất sắc (${overall.excellentQuota.excellent}) vượt mức tham khảo ${overall.excellentQuota.allowed} (20% số hoàn thành tốt, làm tròn từ 0,5); cần cấp có thẩm quyền xem xét. Chưa tính các ngoại lệ của quy định.`,
    );
  }
  if (overall.pendingApproval + overall.inProgress > 0) {
    notes.push(
      `Còn ${overall.pendingApproval + overall.inProgress} hồ sơ chưa phê duyệt (${overall.pendingApproval} chờ phê duyệt, ${overall.inProgress} đang thực hiện); số liệu điểm chỉ tính các hồ sơ đã phê duyệt.`,
    );
  }

  return { period: input.period, scope: input.scope, generatedAt: input.generatedAt, overall, byUnit, rows, notes };
}

export { RATINGS };
