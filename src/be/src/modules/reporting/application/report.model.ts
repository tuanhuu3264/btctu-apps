export type ReportRating = 'XUAT_SAC' | 'HOAN_THANH_TOT' | 'HOAN_THANH' | 'KHONG_HOAN_THANH';
export type ReportStatus = 'PLANNED' | 'SELF_SUBMITTED' | 'REVIEWED' | 'APPROVED';

export const RATINGS: readonly ReportRating[] = ['XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH', 'KHONG_HOAN_THANH'];

export const RATING_LABELS: Readonly<Record<ReportRating, string>> = {
  XUAT_SAC: 'Hoàn thành xuất sắc nhiệm vụ',
  HOAN_THANH_TOT: 'Hoàn thành tốt nhiệm vụ',
  HOAN_THANH: 'Hoàn thành nhiệm vụ',
  KHONG_HOAN_THANH: 'Không hoàn thành nhiệm vụ',
};

export const STATUS_LABELS: Readonly<Record<ReportStatus, string>> = {
  PLANNED: 'Đang thực hiện (đã giao mục tiêu)',
  SELF_SUBMITTED: 'Đã tự chấm, chờ thẩm định',
  REVIEWED: 'Đã thẩm định, chờ phê duyệt',
  APPROVED: 'Đã phê duyệt',
};

/** Hồ sơ đánh giá đã ghép thêm tên, vị trí, đơn vị để lên báo cáo. Không chứa nhận xét hay minh chứng. */
export interface ReportRow {
  evaluationId: string;
  personId: string;
  fullName: string;
  positionTitle: string;
  level: number;
  unitCode: string;
  unitName: string;
  status: ReportStatus;
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: ReportRating | null;
}

export type RatingCounts = Record<ReportRating, number>;

/** Kiểm tra hạn mức xuất sắc (39-QĐ/TU Điều 11 khoản 1.5): chỉ để tham khảo, chưa áp dụng tự động. */
export interface ExcellentQuota {
  excellent: number;
  good: number;
  /** Làm tròn từ 0,5 trở lên thành 1 (05-HD/TU mục 8.2). */
  allowed: number;
  exceeded: boolean;
}

export interface Stats {
  evaluations: number;
  approved: number;
  /** Đã thẩm định, chờ phê duyệt. */
  pendingApproval: number;
  /** Còn đang giao việc, tự chấm hoặc chờ thẩm định. */
  inProgress: number;
  /** Đã phê duyệt / tổng hồ sơ, null nếu chưa có hồ sơ. */
  completionRate: number | null;
  /** Các số liệu dưới đây chỉ tính trên hồ sơ đã phê duyệt. */
  averageTotal: number | null;
  minTotal: number | null;
  maxTotal: number | null;
  ratings: RatingCounts;
  excellentQuota: ExcellentQuota;
}

export interface UnitStats extends Stats {
  unitCode: string;
  unitName: string;
}

export interface ReportPeriod {
  id: string;
  label: string;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
}

/** Một điểm trên biểu đồ xu hướng: số liệu tổng hợp của một kỳ (ADR-027). */
export interface TrendPoint {
  period: ReportPeriod;
  evaluations: number;
  approved: number;
  completionRate: number | null;
  /** Chỉ tính hồ sơ đã phê duyệt; null nếu chưa có. */
  averageTotal: number | null;
  ratings: RatingCounts;
}

export interface Trend {
  type: string;
  scope: 'ALL' | 'LIMITED';
  /** Cũ đến mới. */
  points: TrendPoint[];
}

export interface PeriodReport {
  period: ReportPeriod;
  /** ALL: toàn bộ hồ sơ của kỳ; LIMITED: chỉ phần nằm trong phạm vi của người xem. */
  scope: 'ALL' | 'LIMITED';
  generatedAt: Date;
  overall: Stats;
  byUnit: UnitStats[];
  rows: ReportRow[];
  notes: string[];
}
