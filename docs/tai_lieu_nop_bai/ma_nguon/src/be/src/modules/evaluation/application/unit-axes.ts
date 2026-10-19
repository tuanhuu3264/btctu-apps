import { BadRequestException } from '@nestjs/common';
import { MAX_GENERAL_SCORE, MAX_RESULT_SCORE } from '../../scoring/index.js';
import type { UnitMetrics } from './unit-evaluation.model.js';

/** Nhóm điểm: tiêu chí chung (tối đa 30) hoặc kết quả thực hiện nhiệm vụ (tối đa 70), Quy định 366-QĐ/TW Phụ lục 1. */
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

const axis = (code: string, name: string, kind: AxisKind, maxPoints: number, sortOrder: number, autoMetric: AutoMetric | null = null): AxisDefinition => ({
  code,
  name,
  kind,
  maxPoints,
  sortOrder,
  autoMetric,
  active: true,
});

/**
 * Sáu tiêu chí chung của tập thể theo Quy định 366-QĐ/TW Phụ lục 1 (nhóm I), vận dụng cho phòng thuộc Ban; mỗi tiêu chí 5
 * điểm là đề xuất vì văn bản không chia điểm (bộ tiêu chí mục 3.2, GAP G-36). Dùng chung cho mọi bộ trục.
 */
export const GENERAL_AXES: readonly AxisDefinition[] = [
  axis('C1', 'Xây dựng, chỉnh đốn Đảng; chất lượng cán bộ, đảng viên', 'GENERAL', 5, 10),
  axis('C2', 'Phối hợp công tác; đoàn kết nội bộ', 'GENERAL', 5, 20),
  axis('C3', 'Kiểm tra, giám sát, kỷ luật; không để tham nhũng, tiêu cực, suy thoái', 'GENERAL', 5, 30),
  axis('C4', 'Tập trung dân chủ; chấp hành quy chế làm việc; phân công nhiệm vụ', 'GENERAL', 5, 40),
  axis('C5', 'Cải cách hành chính, chuyển đổi số, văn hóa công vụ', 'GENERAL', 5, 50),
  axis('C6', 'Tự phê bình, khắc phục hạn chế, khuyết điểm', 'GENERAL', 5, 60),
];

/** Phần chung 30 điểm của nhóm kết quả, mọi đơn vị đều có (bộ tiêu chí mục 3.3): KH có gợi ý tự động. */
const COMMON_RESULT_AXES: readonly AxisDefinition[] = [
  axis('KH', 'Hoàn thành chương trình, kế hoạch công tác năm và nhiệm vụ phát sinh', 'RESULT', 15, 200, 'COMPLETED_SHARE'),
  axis('CS', 'Ứng dụng công nghệ thông tin, chuyển đổi số; thống kê, chế độ báo cáo', 'RESULT', 5, 210),
  axis('DN', 'Kết quả đánh giá, xếp loại đội ngũ thuộc đơn vị', 'RESULT', 10, 220),
];

/**
 * Bộ trục mặc định: dùng cho hồ sơ của Ban và cho phòng chưa có bộ riêng (ADR-052). Khung theo Quy định 366-QĐ/TW Phụ lục 1
 * (khối cơ quan tham mưu của Đảng); phân bổ điểm là đề xuất.
 */
export const DEFAULT_AXES: readonly AxisDefinition[] = [
  ...GENERAL_AXES,
  axis('BAN1', 'Tham mưu chủ trương, nghị quyết, quy định, đề án của cấp ủy về tổ chức xây dựng Đảng, tổ chức cán bộ, bảo vệ chính trị nội bộ', 'RESULT', 20, 110),
  axis('BAN2', 'Hướng dẫn, kiểm tra, giám sát, thẩm định trong Đảng bộ tỉnh thuộc lĩnh vực của Ban', 'RESULT', 10, 120),
  axis('BAN3', 'Điều hành nội bộ, phối hợp hoạt động các phòng; bảo vệ, chăm sóc sức khỏe cán bộ', 'RESULT', 10, 130),
  ...COMMON_RESULT_AXES,
];

/**
 * Bộ trục đề xuất của từng phòng theo mã đơn vị khi nhập cơ cấu (bộ tiêu chí Phụ lục A): phần đặc thù 40 điểm theo chức năng,
 * nhiệm vụ tại Quy định 01-QĐ/BTCTU, trục chính nặng hơn trục phụ (05-HD/TU mục IV.1.2). Migration gieo các bộ này.
 */
export const UNIT_AXIS_PRESETS: Readonly<Record<string, readonly AxisDefinition[]>> = {
  TCCB: [
    ...GENERAL_AXES,
    axis('TC1', 'Tham mưu chủ trương, đề án về tổ chức bộ máy, biên chế, cán bộ', 'RESULT', 15, 110),
    axis('TC2', 'Thẩm định nhân sự và quản lý cán bộ diện Tỉnh ủy, Ban Thường vụ quản lý', 'RESULT', 15, 120),
    axis('TC3', 'Chính sách cán bộ, đào tạo bồi dưỡng, tiền lương', 'RESULT', 10, 130),
    ...COMMON_RESULT_AXES,
  ],
  TCDDV: [
    ...GENERAL_AXES,
    axis('DD1', 'Xây dựng tổ chức đảng; hướng dẫn, kiểm tra nghiệp vụ; thẩm định đánh giá, xếp loại tổ chức đảng', 'RESULT', 15, 110),
    axis('DD2', 'Phát triển, quản lý đảng viên và cơ sở dữ liệu đảng viên', 'RESULT', 15, 120),
    axis('DD3', 'Khen thưởng tổ chức đảng, đảng viên; thi đua của Ngành', 'RESULT', 10, 130),
    ...COMMON_RESULT_AXES,
  ],
  BVCTNB: [
    ...GENERAL_AXES,
    axis('BV1', 'Thẩm tra, xác minh cán bộ, đảng viên có vấn đề về chính trị', 'RESULT', 20, 110),
    axis('BV2', 'Tiếp nhận, phân loại, tham mưu xử lý đơn thư khiếu nại, tố cáo gửi Ban', 'RESULT', 10, 120),
    axis('BV3', 'Tham mưu chủ trương, kiểm tra, giám sát công tác bảo vệ chính trị nội bộ; quản lý hồ sơ', 'RESULT', 10, 130),
    ...COMMON_RESULT_AXES,
  ],
  VP: [
    ...GENERAL_AXES,
    axis('VP1', 'Tổng hợp, điều phối chương trình công tác và chế độ thông tin, báo cáo của Ban', 'RESULT', 15, 110),
    axis('VP2', 'Văn thư, lưu trữ, hành chính, quản trị, tài chính, hậu cần', 'RESULT', 15, 120),
    axis('VP3', 'Bảo vệ, chăm sóc sức khỏe và chính sách cán bộ; tổ chức cán bộ, thi đua, cải cách hành chính của cơ quan', 'RESULT', 10, 130),
    ...COMMON_RESULT_AXES,
  ],
};
