import { classifyByScore, totalScore } from '../../scoring/index.js';
import type { Rating } from '../../scoring/index.js';

/**
 * Chính sách tính điểm kết quả thực hiện nhiệm vụ theo Nghị định 335/2025/NĐ-CP Điều 14 đến 17 (ADR-017):
 *
 *   điểm kết quả = KPI × 70
 *   công chức không lãnh đạo, quản lý:  KPI = (a + b + c) / 3                       (Điều 16.1)
 *   công chức lãnh đạo, quản lý:        KPI = (a + b + c + d + đ + e) / 6           (Điều 16.2)
 *
 * a số lượng, b chất lượng, c tiến độ; d, đ, e là ba tiêu chí lãnh đạo (kết quả hoạt động của đơn vị, khả năng tổ chức
 * triển khai, năng lực tập hợp đoàn kết), mỗi tiêu chí đạt 100% hoặc 50% (Điều 15.3). Các điểm còn mở ghi ở GAP G-02, G-21.
 */
export interface ScoringParams {
  /** Nhãn phiên bản chính sách, lưu cùng hồ sơ để tái lập kết quả. */
  version: string;
  /** Mỗi lần chưa đạt do sai sót lớn (b) hoặc chậm (c) trừ chừng này điểm của dòng việc đó: 25% (Nghị định 335/2025, điểm b, c khoản 2 Điều 14). */
  penaltyPerOccurrence: number;
  /** Trần điểm kết quả thực hiện nhiệm vụ (05-HD/TU mục IV.1.2). */
  resultMax: number;
  /** Trần điểm nhóm tiêu chí chung (05-HD/TU mục IV.1.1). */
  generalMax: number;
  /** Cấp vị trí lớn nhất được coi là lãnh đạo, quản lý: 1 Trưởng ban đến 4 Phó phòng (giả định G-21). */
  leaderMaxLevel: number;
}

export const DEFAULT_SCORING_PARAMS: ScoringParams = {
  version: 'v3-nd335',
  penaltyPerOccurrence: 0.25,
  resultMax: 70,
  generalMax: 30,
  leaderMaxLevel: 4,
};

/** Dòng chỉ tiêu đã gắn hệ số quy đổi từ danh mục. */
export interface ScoredTask {
  coefficient: number;
  plannedQuantity: number;
  completedQuantity: number;
  qualityLevel: number | null;
  /** Số lần chậm và số lần chưa đạt (0 với dòng nhập tay). */
  lateCount: number;
  reworkCount: number;
}

/** Ba tiêu chí của cán bộ lãnh đạo, quản lý (Điều 15.3): d, đ, e. Mỗi tiêu chí đạt 100% hoặc 50%. */
export interface Leadership {
  /** Kết quả hoạt động của đơn vị: 100% nếu mọi công chức thuộc quyền từ hoàn thành nhiệm vụ trở lên. */
  unitResult: number;
  /** Khả năng tổ chức triển khai nhiệm vụ. */
  organizing: number;
  /** Năng lực tập hợp, đoàn kết công chức thuộc phạm vi quản lý. */
  solidarity: number;
}

export const LEADERSHIP_LEVELS: readonly number[] = [0.5, 1];

/** Các thành phần của KPI, đều trong khoảng 0–1. */
export interface KpiBreakdown {
  quantity: number;
  quality: number;
  timeliness: number;
  /** Trung bình ba tiêu chí lãnh đạo, chỉ để hiển thị (KPI dùng từng tiêu chí riêng). null nếu không phải lãnh đạo hoặc chưa chấm. */
  leadership: number | null;
  kpi: number;
}

export interface Evaluated {
  resultScore: number;
  /** null khi chưa có điểm tiêu chí chung. */
  totalScore: number | null;
  rating: Rating | null;
  /**
   * false nếu còn dòng đã có kết quả nhưng chưa được đánh giá chất lượng, hoặc cán bộ lãnh đạo chưa được chấm D
   * (điểm chỉ tạm tính).
   */
  complete: boolean;
  breakdown: KpiBreakdown;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function leadershipRate(l: Leadership): number {
  return (l.unitResult + l.organizing + l.solidarity) / 3;
}

/** Hệ số còn lại của một dòng sau `occurrences` lần bị trừ (không âm). */
const remaining = (occurrences: number, params: ScoringParams) => Math.max(0, 1 - params.penaltyPerOccurrence * occurrences);

/**
 * a = Σ(hệ số × SL đạt) / Σ(hệ số × SL giao). SL đạt không vượt SL giao: hoàn thành 100% là đạt 100%, vượt mức
 *     được ghi nhận ở nơi khác (Phụ lục 2 mục 2, ý i), không bù cho việc khác.
 * b = Σ(hệ số × SL đạt × (1 − 25% × số lần sai sót lớn)) / Σ(hệ số × SL giao)   (Điều 14.2.b: mẫu số là số lượng được giao)
 * c = Σ(hệ số × SL đạt × (1 − 25% × số lần chậm)) / Σ(hệ số × SL giao)          (Điều 14.2.c)
 * Dòng chưa đánh giá chất lượng thì không có SL đạt.
 * Lãnh đạo, quản lý đã chấm d, đ, e: KPI = (a + b + c + d + đ + e) / 6; còn lại KPI = (a + b + c) / 3.
 * Không có chỉ tiêu nào (tổng giao bằng 0) thì mọi thành phần bằng 0, kể cả d, đ, e.
 */
export function kpiOf(tasks: readonly ScoredTask[], leadership: Leadership | null, isLeader: boolean, params: ScoringParams = DEFAULT_SCORING_PARAMS): KpiBreakdown {
  const planned = tasks.reduce((sum, t) => sum + t.coefficient * t.plannedQuantity, 0);
  if (planned <= 0) return { quantity: 0, quality: 0, timeliness: 0, leadership: null, kpi: 0 };

  let done = 0;
  let qualityAdjusted = 0;
  let timelyAdjusted = 0;
  for (const t of tasks) {
    const accepted = t.qualityLevel === null ? 0 : Math.min(t.completedQuantity, t.plannedQuantity);
    const value = t.coefficient * accepted;
    done += value;
    qualityAdjusted += value * remaining(t.reworkCount, params);
    timelyAdjusted += value * remaining(t.lateCount, params);
  }

  const quantity = done / planned;
  const quality = qualityAdjusted / planned;
  const timeliness = timelyAdjusted / planned;
  const scored = isLeader && leadership ? leadership : null;
  const parts = scored ? [quantity, quality, timeliness, scored.unitResult, scored.organizing, scored.solidarity] : [quantity, quality, timeliness];
  return {
    quantity: round4(quantity),
    quality: round4(quality),
    timeliness: round4(timeliness),
    leadership: scored ? round4(leadershipRate(scored)) : null,
    kpi: round4(parts.reduce((s, x) => s + x, 0) / parts.length),
  };
}

export function resultScore(
  tasks: readonly ScoredTask[],
  params: ScoringParams = DEFAULT_SCORING_PARAMS,
  leadership: Leadership | null = null,
  isLeader = false,
): number {
  return round2(Math.min(params.resultMax, kpiOf(tasks, leadership, isLeader, params).kpi * params.resultMax));
}

export function evaluate(
  tasks: readonly ScoredTask[],
  generalScore: number | null,
  params: ScoringParams = DEFAULT_SCORING_PARAMS,
  leadership: Leadership | null = null,
  isLeader = false,
): Evaluated {
  const breakdown = kpiOf(tasks, leadership, isLeader, params);
  const result = round2(Math.min(params.resultMax, breakdown.kpi * params.resultMax));
  const complete = tasks.every((t) => t.completedQuantity === 0 || t.qualityLevel !== null) && (!isLeader || leadership !== null);
  if (generalScore === null) return { resultScore: result, totalScore: null, rating: null, complete, breakdown };
  const total = round2(totalScore(generalScore, result));
  return { resultScore: result, totalScore: total, rating: classifyByScore(total), complete, breakdown };
}
