import { classifyByScore, DEFAULT_THRESHOLDS } from '../../scoring/index.js';
import type { Rating } from '../../scoring/index.js';
import { DEFAULT_SCORING_PARAMS, evaluate } from './scoring-policy.js';
import type { Evaluated, Leadership, ScoredTask, ScoringParams } from './scoring-policy.js';

/**
 * Giải thích điểm và mô phỏng "nếu…" (PLAN sáng tạo, mục 1 và 2). Chỉ đọc lại công thức của scoring-policy (Nghị định 335/2025
 * Điều 14 đến 17), không thêm quy tắc chấm điểm mới: điểm giải thích cộng lại đúng bằng điểm kết quả của hồ sơ.
 */
export interface InsightTask extends ScoredTask {
  id: string;
  code: string;
  name: string;
}

export type ComponentKey = 'quantity' | 'quality' | 'timeliness' | 'unitResult' | 'organizing' | 'solidarity';

export interface InsightComponent {
  key: ComponentKey;
  label: string;
  /** Công thức tóm tắt, kèm điều khoản. */
  basis: string;
  /** Tỷ lệ 0–1; null với tiêu chí lãnh đạo chưa chấm. */
  rate: number | null;
  /** Số điểm kết quả đạt từ thành phần này và mức tối đa của nó. */
  points: number;
  maxPoints: number;
  /** maxPoints − points. */
  lostPoints: number;
}

export interface InsightLine {
  taskId: string;
  code: string;
  name: string;
  coefficient: number;
  planned: number;
  completed: number;
  /** Số lượng được tính (đã đánh giá chất lượng, không vượt số giao). */
  accepted: number;
  extra: boolean;
  /** Tỷ trọng của dòng trong mẫu số (hệ số × SL giao ÷ tổng); null với việc đột xuất (không vào mẫu số). */
  share: number | null;
  /** Còn chờ đánh giá chất lượng nên chưa được tính. */
  pendingQuality: boolean;
  lateCount: number;
  reworkCount: number;
  /** Điểm dòng này đóng góp vào điểm kết quả. */
  points: number;
  /** Điểm mất do chưa hoàn thành đủ số lượng, do sai sót lớn (chưa đạt), do chậm tiến độ. */
  lostQuantity: number;
  lostQuality: number;
  lostTimeliness: number;
}

export interface ScoreExplanation {
  isLeader: boolean;
  /** Trọng số mỗi thành phần: 1/3 (không lãnh đạo, hoặc lãnh đạo chưa chấm D) hoặc 1/6. */
  componentCount: 3 | 6;
  components: InsightComponent[];
  lines: InsightLine[];
  resultScore: number;
  resultMax: number;
  generalScore: number | null;
  totalScore: number | null;
  rating: Rating | null;
  /** Thành phần a, b, c bị chặn ở 100% (phần vượt do việc đột xuất không cộng thêm). */
  capped: ComponentKey[];
  notes: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const remaining = (occurrences: number, p: ScoringParams) => Math.max(0, 1 - p.penaltyPerOccurrence * occurrences);

const LABELS: Record<ComponentKey, { label: string; basis: string }> = {
  quantity: { label: 'a. Số lượng', basis: 'Σ(hệ số × SL đạt) ÷ Σ(hệ số × SL giao); Điều 14.2.a' },
  quality: { label: 'b. Chất lượng', basis: 'như a, mỗi lần sai sót lớn trừ 25% của dòng việc; Điều 14.2.b' },
  timeliness: { label: 'c. Tiến độ', basis: 'như a, mỗi lần chậm trừ 25% của dòng việc; Điều 14.2.c' },
  unitResult: { label: 'd. Kết quả hoạt động của đơn vị', basis: 'lãnh đạo, quản lý: 100% hoặc 50%; Điều 15.3' },
  organizing: { label: 'đ. Khả năng tổ chức triển khai', basis: 'lãnh đạo, quản lý: 100% hoặc 50%; Điều 15.3' },
  solidarity: { label: 'e. Năng lực tập hợp, đoàn kết', basis: 'lãnh đạo, quản lý: 100% hoặc 50%; Điều 15.3' },
};

export function explainScore(
  tasks: readonly InsightTask[],
  generalScore: number | null,
  leadership: Leadership | null,
  isLeader: boolean,
  params: ScoringParams = DEFAULT_SCORING_PARAMS,
): ScoreExplanation {
  const ev = evaluate(tasks, generalScore, params, leadership, isLeader);
  const scoredLeadership = isLeader && leadership ? leadership : null;
  const n = scoredLeadership ? 6 : 3;
  const unit = params.resultMax / n; // điểm tối đa của mỗi thành phần
  const denominator = tasks.reduce((s, t) => (t.extra ? s : s + t.coefficient * t.plannedQuantity), 0);
  const notes: string[] = [];

  const lines: InsightLine[] = tasks.map((t) => {
    const accepted = t.qualityLevel === null ? 0 : Math.min(t.completedQuantity, t.plannedQuantity);
    const value = t.coefficient * accepted;
    const unitPts = denominator > 0 ? unit / denominator : 0; // điểm cho mỗi đơn vị (hệ số × SL)
    const q = remaining(t.reworkCount, params);
    const c = remaining(t.lateCount, params);
    return {
      taskId: t.id,
      code: t.code,
      name: t.name,
      coefficient: t.coefficient,
      planned: t.plannedQuantity,
      completed: t.completedQuantity,
      accepted,
      extra: !!t.extra,
      share: t.extra || denominator <= 0 ? null : (t.coefficient * t.plannedQuantity) / denominator,
      pendingQuality: t.completedQuantity > 0 && t.qualityLevel === null,
      lateCount: t.lateCount,
      reworkCount: t.reworkCount,
      points: r2(value * (1 + q + c) * unitPts),
      // Phần chưa đạt thiếu ở cả ba thành phần a, b, c (cùng mẫu số) nên tính 3 lần.
      lostQuantity: t.extra ? 0 : r2(3 * t.coefficient * (t.plannedQuantity - accepted) * unitPts),
      lostQuality: r2(value * (1 - q) * unitPts),
      lostTimeliness: r2(value * (1 - c) * unitPts),
    };
  });

  const breakdown = ev.breakdown;
  const abc: [ComponentKey, number][] = [
    ['quantity', breakdown.quantity],
    ['quality', breakdown.quality],
    ['timeliness', breakdown.timeliness],
  ];
  const components: InsightComponent[] = abc.map(([key, rate]) => ({
    key,
    ...LABELS[key],
    rate,
    points: r2(rate * unit),
    maxPoints: r2(unit),
    lostPoints: r2((1 - rate) * unit),
  }));

  // Phần vượt 100% (do việc đột xuất bù cho việc thường) bị chặn: báo để người đọc không thắc mắc vì sao dòng cộng lại lớn hơn.
  const capped: ComponentKey[] = [];
  if (denominator > 0) {
    const raw = { quantity: 0, quality: 0, timeliness: 0 };
    for (const t of tasks) {
      const accepted = t.qualityLevel === null ? 0 : Math.min(t.completedQuantity, t.plannedQuantity);
      const v = t.coefficient * accepted;
      raw.quantity += v;
      raw.quality += v * remaining(t.reworkCount, params);
      raw.timeliness += v * remaining(t.lateCount, params);
    }
    for (const k of ['quantity', 'quality', 'timeliness'] as const) if (raw[k] / denominator > 1) capped.push(k);
  } else if (tasks.length > 0) {
    notes.push('Chưa có việc giao ban đầu (mẫu số bằng 0) nên chưa tính được điểm kết quả; việc đột xuất không vào mẫu số.');
  }

  if (isLeader) {
    const parts: [ComponentKey, number | null][] = [
      ['unitResult', scoredLeadership?.unitResult ?? null],
      ['organizing', scoredLeadership?.organizing ?? null],
      ['solidarity', scoredLeadership?.solidarity ?? null],
    ];
    for (const [key, rate] of parts) {
      const rowUnit = params.resultMax / 6;
      components.push({ key, ...LABELS[key], rate, points: r2((rate ?? 0) * rowUnit), maxPoints: r2(rowUnit), lostPoints: r2((1 - (rate ?? 0)) * rowUnit) });
    }
    if (!scoredLeadership) {
      notes.push('Cán bộ lãnh đạo, quản lý chưa được chấm ba tiêu chí d, đ, e: điểm hiện chia cho 3 thành phần (tạm tính); khi chấm xong sẽ chia cho 6 nên điểm có thể đổi.');
    }
  }

  if (lines.some((l) => l.pendingQuality)) {
    notes.push('Có dòng đã ghi kết quả nhưng chưa được đánh giá chất lượng: số lượng của dòng đó chưa được tính vào điểm.');
  }
  if (capped.length > 0) notes.push('Có thành phần đã đạt trần 100%: phần vượt do việc đột xuất không cộng thêm.');
  if (generalScore === null) notes.push('Chưa có điểm tiêu chí chung (tối đa 30) nên chưa có tổng điểm và xếp loại.');

  return {
    isLeader,
    componentCount: n,
    components,
    lines,
    resultScore: ev.resultScore,
    resultMax: params.resultMax,
    generalScore,
    totalScore: ev.totalScore,
    rating: ev.rating,
    capped,
    notes,
  };
}

// ---- mô phỏng

export interface TaskOverride {
  taskId: string;
  completedQuantity?: number;
  lateCount?: number;
  reworkCount?: number;
  qualityLevel?: number | null;
}

export interface Simulation {
  base: Evaluated;
  result: Evaluated;
  explanation: ScoreExplanation;
  deltaResult: number;
  deltaTotal: number | null;
}

export function applyOverrides(tasks: readonly InsightTask[], overrides: readonly TaskOverride[]): InsightTask[] {
  const byId = new Map(overrides.map((o) => [o.taskId, o]));
  return tasks.map((t) => {
    const o = byId.get(t.id);
    if (!o) return t;
    return {
      ...t,
      completedQuantity: o.completedQuantity ?? t.completedQuantity,
      lateCount: o.lateCount ?? t.lateCount,
      reworkCount: o.reworkCount ?? t.reworkCount,
      qualityLevel: o.qualityLevel === undefined ? t.qualityLevel : o.qualityLevel,
    };
  });
}

export interface SimulationInput {
  tasks: readonly InsightTask[];
  generalScore: number | null;
  leadership: Leadership | null;
  isLeader: boolean;
}

/** Tính lại điểm với các giả định, so với hiện trạng. Không ghi gì vào hồ sơ. */
export function simulate(input: SimulationInput, overrides: readonly TaskOverride[], generalOverride?: number | null, params: ScoringParams = DEFAULT_SCORING_PARAMS): Simulation {
  const base = evaluate(input.tasks, input.generalScore, params, input.leadership, input.isLeader);
  const general = generalOverride === undefined ? input.generalScore : generalOverride;
  const modified = applyOverrides(input.tasks, overrides);
  const result = evaluate(modified, general, params, input.leadership, input.isLeader);
  return {
    base,
    result,
    explanation: explainScore(modified, general, input.leadership, input.isLeader, params),
    deltaResult: r2(result.resultScore - base.resultScore),
    deltaTotal: result.totalScore !== null && base.totalScore !== null ? r2(result.totalScore - base.totalScore) : null,
  };
}

// ---- gợi ý

export interface Move {
  kind: 'COMPLETE' | 'LATE' | 'REWORK';
  taskId: string;
  code: string;
  name: string;
  /** Mô tả ngắn của việc cần làm hoặc rủi ro. */
  text: string;
  /** Thay đổi điểm kết quả nếu xảy ra. */
  deltaResult: number;
  /** Mức xếp loại sau khi xảy ra (null nếu chưa có điểm chung). */
  ratingAfter: Rating | null;
}

export interface RatingGoal {
  current: Rating;
  next: Rating | null;
  /** Mức điểm tổng của xếp loại kế tiếp. */
  threshold: number | null;
  /** Còn thiếu bao nhiêu điểm tổng (0 nếu đã đạt mức cao nhất). */
  missing: number;
  /** Điểm tổng tối đa nếu hoàn thành hết việc đã giao và không phát sinh chậm, sai sót lớn thêm. */
  ceiling: number;
  /** Có đạt được `next` chỉ bằng cách hoàn thành nốt việc đã giao không. */
  reachable: boolean;
  /** Các việc nên làm theo thứ tự mang lại nhiều điểm nhất, cho tới khi đủ điểm (hoặc hết việc). */
  steps: Move[];
}

export interface Suggestions {
  opportunities: Move[];
  risks: Move[];
  goal: RatingGoal | null;
}

const NEXT: Record<Rating, { next: Rating | null; threshold: number | null }> = {
  KHONG_HOAN_THANH: { next: 'HOAN_THANH', threshold: DEFAULT_THRESHOLDS.fair },
  HOAN_THANH: { next: 'HOAN_THANH_TOT', threshold: DEFAULT_THRESHOLDS.good },
  HOAN_THANH_TOT: { next: 'XUAT_SAC', threshold: DEFAULT_THRESHOLDS.excellent },
  XUAT_SAC: { next: null, threshold: null },
};

/** Điểm tổng tạm để so sánh khi chưa có điểm chung: dùng kết quả riêng (không xếp loại). */
export function suggest(input: SimulationInput, params: ScoringParams = DEFAULT_SCORING_PARAMS): Suggestions {
  const { tasks, generalScore, leadership, isLeader } = input;
  const base = evaluate(tasks, generalScore, params, leadership, isLeader);
  const ratingOf = (e: Evaluated) => (e.totalScore === null ? null : classifyByScore(e.totalScore));
  const score = (list: readonly InsightTask[]) => evaluate(list, generalScore, params, leadership, isLeader);

  const completeMove = (t: InsightTask, list: readonly InsightTask[]): Move | null => {
    if (t.extra) return null;
    const accepted = t.qualityLevel === null ? 0 : Math.min(t.completedQuantity, t.plannedQuantity);
    if (accepted >= t.plannedQuantity) return null;
    const after = score(applyOverrides(list, [{ taskId: t.id, completedQuantity: t.plannedQuantity, qualityLevel: t.qualityLevel ?? 2 }]));
    const cur = score(list);
    const left = t.plannedQuantity - accepted;
    const pending = t.completedQuantity > 0 && t.qualityLevel === null;
    return {
      kind: 'COMPLETE',
      taskId: t.id,
      code: t.code,
      name: t.name,
      text: pending ? `Đánh giá chất lượng và xác nhận dòng ${t.code} (đã ghi ${t.completedQuantity}/${t.plannedQuantity})` : `Hoàn thành nốt ${left} đơn vị của ${t.code}`,
      deltaResult: r2(after.resultScore - cur.resultScore),
      ratingAfter: ratingOf(after),
    };
  };

  const opportunities = tasks
    .map((t) => completeMove(t, tasks))
    .filter((m): m is Move => m !== null && m.deltaResult > 0)
    .sort((a, b) => b.deltaResult - a.deltaResult)
    .slice(0, 5);

  const risks: Move[] = [];
  for (const t of tasks) {
    const accepted = t.qualityLevel === null ? 0 : Math.min(t.completedQuantity, t.plannedQuantity);
    if (accepted <= 0) continue;
    for (const kind of ['LATE', 'REWORK'] as const) {
      const field = kind === 'LATE' ? 'lateCount' : 'reworkCount';
      const after = score(applyOverrides(tasks, [{ taskId: t.id, [field]: t[field] + 1 }]));
      risks.push({
        kind,
        taskId: t.id,
        code: t.code,
        name: t.name,
        text: kind === 'LATE' ? `Thêm một lần chậm tiến độ ở ${t.code}` : `Thêm một lần sai sót lớn (chưa đạt) ở ${t.code}`,
        deltaResult: r2(after.resultScore - base.resultScore),
        ratingAfter: ratingOf(after),
      });
    }
  }
  risks.sort((a, b) => a.deltaResult - b.deltaResult);

  let goal: RatingGoal | null = null;
  if (base.totalScore !== null && base.rating !== null) {
    const { next, threshold } = NEXT[base.rating];
    // Hoàn thành hết: giả định mọi dòng đạt đủ số giao, giữ nguyên số lần chậm và sai sót đã có.
    const steps: Move[] = [];
    let working: readonly InsightTask[] = tasks;
    let current = base;
    for (let guard = 0; guard < tasks.length; guard++) {
      if (threshold !== null && current.totalScore !== null && current.totalScore >= threshold) break;
      const moves = working.map((t) => completeMove(t, working)).filter((m): m is Move => m !== null && m.deltaResult > 0);
      if (moves.length === 0) break;
      moves.sort((a, b) => b.deltaResult - a.deltaResult);
      const best = moves[0];
      steps.push(best);
      working = applyOverrides(working, [{ taskId: best.taskId, completedQuantity: working.find((t) => t.id === best.taskId)!.plannedQuantity, qualityLevel: working.find((t) => t.id === best.taskId)!.qualityLevel ?? 2 }]);
      current = score(working);
    }
    // Trần: hoàn thành tất cả (kể cả khi đã đủ mức kế tiếp).
    let all: readonly InsightTask[] = tasks;
    for (const t of tasks) if (!t.extra) all = applyOverrides(all, [{ taskId: t.id, completedQuantity: t.plannedQuantity, qualityLevel: t.qualityLevel ?? 2 }]);
    const ceiling = score(all).totalScore ?? base.totalScore;
    goal = {
      current: base.rating,
      next,
      threshold,
      missing: threshold === null ? 0 : Math.max(0, r2(threshold - base.totalScore)),
      ceiling,
      reachable: threshold === null || ceiling >= threshold,
      steps: threshold !== null && base.totalScore < threshold ? steps : [],
    };
  }

  return { opportunities, risks: risks.slice(0, 4), goal };
}
