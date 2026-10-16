import { BadRequestException } from '@nestjs/common';
import { MAX_GENERAL_SCORE, MAX_RESULT_SCORE } from '../../scoring/index.js';
import type { UnitMetrics } from './unit-evaluation.model.js';

/** Nhóm điểm: tiêu chí chung (tối đa 30) hoặc kết quả thực hiện nhiệm vụ (tối đa 70), Nghị định 335 Điều 6, 7. */
export type AxisKind = 'GENERAL' | 'RESULT';
/** Cách tự gợi ý điểm cho trục từ số liệu tham chiếu; null là nhập tay hoàn toàn. */
export type AutoMetric = 'COMPLETED_SHARE';

export const AXIS_KINDS: readonly AxisKind[] = ['GENERAL', 'RESULT'];
export const AUTO_METRICS: readonly AutoMetric[] = ['COMPLETED_SHARE'];
export const KIND_MAX: Record<AxisKind, number> = { GENERAL: MAX_GENERAL_SCORE, RESULT: MAX_RESULT_SCORE };

/** Định nghĩa một trục chấm điểm tập thể (ADR-036). */
export interface AxisDefinition {
  code: string;
  name: string;
  kind: AxisKind;
  maxPoints: number;
  sortOrder: number;
  autoMetric: AutoMetric | null;
  active: boolean;
}

/** Điểm của một trục kèm ảnh chụp định nghĩa lúc chấm, để đổi cấu hình về sau không làm đổi hồ sơ cũ. */
export interface AxisScore {
  code: string;
  name: string;
  kind: AxisKind;
  max: number;
  score: number;
}

export interface AxisInput {
  code: string;
  score: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const active = (defs: readonly AxisDefinition[], kind: AxisKind) => defs.filter((d) => d.active && d.kind === kind).sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

export interface ScoreInput {
  generalScore?: number;
  resultScore?: number;
  axes?: readonly AxisInput[];
}

export interface ResolvedScores {
  generalScore: number;
  resultScore: number;
  /** Có khi ít nhất một nhóm chấm theo trục; null khi cả hai nhóm nhập một số. */
  axes: AxisScore[] | null;
}

/**
 * Điểm của hồ sơ từ đầu vào. Mỗi nhóm có trục đang bật thì phải chấm đủ mọi trục (0 đến điểm tối đa) và điểm nhóm là tổng;
 * nhóm không có trục đang bật thì nhập một số như ADR-030.
 */
export function resolveScores(defs: readonly AxisDefinition[], input: ScoreInput): ResolvedScores {
  const scored: AxisScore[] = [];
  const totals = {} as Record<AxisKind, number>;
  const given = new Map<string, number>();
  for (const a of input.axes ?? []) {
    if (given.has(a.code)) throw new BadRequestException(`Trục ${a.code} được chấm hai lần`);
    given.set(a.code, a.score);
  }
  const known = new Set(defs.filter((d) => d.active).map((d) => d.code));
  for (const code of given.keys()) {
    if (!known.has(code)) throw new BadRequestException(`Trục ${code} không có hoặc đã tắt`);
  }

  for (const kind of AXIS_KINDS) {
    const axes = active(defs, kind);
    const single = kind === 'GENERAL' ? input.generalScore : input.resultScore;
    const label = kind === 'GENERAL' ? 'Điểm tiêu chí chung' : 'Điểm kết quả nhiệm vụ';
    if (axes.length === 0) {
      if (single === undefined || !Number.isFinite(single) || single < 0 || single > KIND_MAX[kind]) {
        throw new BadRequestException(`${label} phải từ 0 đến ${KIND_MAX[kind]}`);
      }
      totals[kind] = single;
      continue;
    }
    let sum = 0;
    for (const axis of axes) {
      const score = given.get(axis.code);
      if (score === undefined) throw new BadRequestException(`Thiếu điểm trục ${axis.code} (${axis.name})`);
      if (!Number.isFinite(score) || score < 0 || score > axis.maxPoints) {
        throw new BadRequestException(`Điểm trục ${axis.code} phải từ 0 đến ${axis.maxPoints}`);
      }
      scored.push({ code: axis.code, name: axis.name, kind, max: axis.maxPoints, score });
      sum += score;
    }
    totals[kind] = round2(sum);
  }
  return { generalScore: totals.GENERAL, resultScore: totals.RESULT, axes: scored.length > 0 ? scored : null };
}

/** Lỗi cấu hình: mã trùng hoặc sai dạng, điểm tối đa không dương, tổng mỗi nhóm khác 30 hoặc 70. Rỗng là hợp lệ. */
export function validateAxisConfig(defs: readonly AxisDefinition[]): string[] {
  const errors: string[] = [];
  const codes = new Set<string>();
  for (const d of defs) {
    if (!/^[A-Z][A-Z0-9]{0,9}$/.test(d.code)) errors.push(`Mã trục "${d.code}" phải gồm chữ in hoa và số, tối đa 10 ký tự, bắt đầu bằng chữ`);
    if (codes.has(d.code)) errors.push(`Mã trục ${d.code} bị trùng`);
    codes.add(d.code);
    if (d.name.trim().length < 3) errors.push(`Trục ${d.code} cần tên ít nhất 3 ký tự`);
    if (!(d.maxPoints > 0)) errors.push(`Trục ${d.code} cần điểm tối đa lớn hơn 0`);
    if (d.autoMetric !== null && !AUTO_METRICS.includes(d.autoMetric)) errors.push(`Trục ${d.code} có cách gợi ý không hợp lệ`);
  }
  for (const kind of AXIS_KINDS) {
    const axes = active(defs, kind);
    if (axes.length === 0) continue;
    const sum = round2(axes.reduce((s, d) => s + d.maxPoints, 0));
    if (sum !== KIND_MAX[kind]) {
      errors.push(`Tổng điểm tối đa các trục ${kind === 'GENERAL' ? 'tiêu chí chung' : 'kết quả nhiệm vụ'} đang bật là ${sum}, phải bằng ${KIND_MAX[kind]}`);
    }
  }
  return errors;
}

/** Điểm gợi ý theo số liệu tham chiếu cho trục có `autoMetric`; trục nhập tay không có gợi ý. */
export function suggestedScores(defs: readonly AxisDefinition[], metrics: UnitMetrics): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs) {
    if (!d.active || d.autoMetric !== 'COMPLETED_SHARE' || metrics.works === 0) continue;
    out[d.code] = round2((d.maxPoints * metrics.completed) / metrics.works);
  }
  return out;
}

/** Cấu hình mặc định theo bộ tiêu chí: ba nhóm chung 10, sáu trục kết quả 15, 20, 10, 10, 10, 5 (đề xuất). */
export const DEFAULT_AXES: readonly AxisDefinition[] = [
  { code: 'G1', name: 'Chấp hành đường lối, chỉ đạo; xây dựng và thực hiện kế hoạch', kind: 'GENERAL', maxPoints: 10, sortOrder: 10, autoMetric: null, active: true },
  { code: 'G2', name: 'Quản lý công chức, môi trường làm việc, đoàn kết, kỷ luật kỷ cương', kind: 'GENERAL', maxPoints: 10, sortOrder: 20, autoMetric: null, active: true },
  { code: 'G3', name: 'Cải cách hành chính, chuyển đổi số nội bộ, khắc phục tồn tại hạn chế', kind: 'GENERAL', maxPoints: 10, sortOrder: 30, autoMetric: null, active: true },
  { code: 'T1', name: 'Thể chế hóa, tham mưu văn bản', kind: 'RESULT', maxPoints: 15, sortOrder: 110, autoMetric: null, active: true },
  { code: 'T2', name: 'Hoàn thành chương trình, kế hoạch năm và nhiệm vụ phát sinh', kind: 'RESULT', maxPoints: 20, sortOrder: 120, autoMetric: 'COMPLETED_SHARE', active: true },
  { code: 'T3', name: 'Quản lý, điều hành, không sai phạm', kind: 'RESULT', maxPoints: 10, sortOrder: 130, autoMetric: null, active: true },
  { code: 'T4', name: 'Phối hợp, điều phối, sáng kiến', kind: 'RESULT', maxPoints: 10, sortOrder: 140, autoMetric: null, active: true },
  { code: 'T5', name: 'Chuyển đổi số, đơn giản hóa thủ tục, khoa học công nghệ', kind: 'RESULT', maxPoints: 10, sortOrder: 150, autoMetric: null, active: true },
  { code: 'T6', name: 'Giải quyết hồ sơ, đơn thư, kiến nghị', kind: 'RESULT', maxPoints: 5, sortOrder: 160, autoMetric: null, active: true },
];
