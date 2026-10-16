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
  /** Số hồ sơ (phiếu). Cán bộ kiêm nhiệm có một phiếu cho mỗi vị trí nên số phiếu có thể lớn hơn số người (ADR-047). */
  evaluations: number;
  /** Số cán bộ khác nhau có hồ sơ (đã loại trùng người kiêm nhiệm). */
  people: number;
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

/** Một hồ sơ đánh giá tập thể đã ghép tên người đứng đầu (ADR-030, ADR-031). Không chứa nhận xét. */
export interface UnitReportRow {
  evaluationId: string;
  unitCode: string;
  unitName: string;
  unitType: 'BAN' | 'PHONG';
  headName: string;
  status: ReportStatus;
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: ReportRating | null;
  /** Số điều kiện xếp loại chưa đạt hoặc cảnh báo hạn mức; chi tiết xem ở hồ sơ. */
  warnings: number;
  /** Điểm từng trục do người thẩm định chấm (ADR-036); rỗng khi hồ sơ chấm một số hoặc chưa thẩm định. */
  axes: ReportAxisScore[];
}

/** Điểm một trục của một hồ sơ tập thể, kèm ảnh chụp định nghĩa trục lúc chấm. */
export interface ReportAxisScore {
  code: string;
  name: string;
  kind: 'GENERAL' | 'RESULT';
  maxPoints: number;
  points: number;
}

/** Tổng hợp một trục trên các hồ sơ đã phê duyệt có chấm theo trục (ADR-037). */
export interface AxisSummary {
  code: string;
  name: string;
  kind: 'GENERAL' | 'RESULT';
  maxPoints: number;
  /** Số hồ sơ đã phê duyệt có điểm trục này. */
  count: number;
  /** Trung bình điểm; null khi chưa có hồ sơ nào. */
  average: number | null;
  /** Tỷ lệ trung bình trên điểm tối đa, 0 đến 1, để so sánh trục có điểm tối đa khác nhau. */
  ratio: number | null;
  lowest: number | null;
}

/**
 * Hạn mức xuất sắc của tập thể (Nghị định 335 Điều 8.5.a): không quá 20% số tổ chức hoàn thành tốt.
 * `allowed` là số thực (ví dụ 0,8) vì điều khoản không nêu cách làm tròn; ngoại lệ 25% chưa tính.
 */
export interface UnitQuota {
  excellent: number;
  good: number;
  allowed: number;
  exceeded: boolean;
}

export interface UnitReport {
  period: ReportPeriod;
  scope: 'ALL' | 'LIMITED';
  generatedAt: Date;
  units: number;
  approved: number;
  pendingApproval: number;
  inProgress: number;
  /** Chỉ tính hồ sơ đã phê duyệt. */
  ratings: RatingCounts;
  averageTotal: number | null;
  quota: UnitQuota;
  /** Trung bình từng trục, chỉ tính hồ sơ đã phê duyệt có chấm theo trục (ADR-037). */
  axisSummary: AxisSummary[];
  rows: UnitReportRow[];
  notes: string[];
}
