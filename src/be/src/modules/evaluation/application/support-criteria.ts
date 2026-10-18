import { BadRequestException } from '@nestjs/common';

/**
 * Tiêu chí đánh giá kết quả thực hiện nhiệm vụ của người lao động làm công tác hỗ trợ, phục vụ (lái xe, phục vụ, lễ tân,
 * bảo vệ, kỹ thuật...) theo Sổ tay của Bộ Nội vụ (2026) Chương III (ADR-053):
 *
 *   điểm đánh giá = (a + b + c) / 3,   điểm kết quả = điểm đánh giá × 70
 *
 * a chất lượng công việc, b tuân thủ quy định, quy trình, c hiệu quả công việc; mỗi tiêu chí là tỷ lệ % từ 0 đến 100. Người lao
 * động tự đánh giá, người quản lý đánh giá; điểm chính thức theo người quản lý. Tiêu chí chung 30 điểm như công chức.
 */
export interface SupportScores {
  /** a. Chất lượng công việc (%). */
  quality: number;
  /** b. Tuân thủ quy định, quy trình công việc (%). */
  compliance: number;
  /** c. Hiệu quả công việc (%). */
  efficiency: number;
}

export const SUPPORT_POLICY = 'support-v1-sotay-bnv';
const RESULT_MAX = 70;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Kiểm tra ba tỷ lệ; trả về bản sao đã làm tròn 2 chữ số. */
export function checkSupportScores(input: SupportScores | undefined | null, who: string): SupportScores {
  if (!input) throw new BadRequestException(`${who} cần chấm ba tiêu chí chất lượng, tuân thủ quy trình, hiệu quả (0 đến 100%)`);
  for (const [label, v] of [
    ['Chất lượng công việc', input.quality],
    ['Tuân thủ quy định, quy trình', input.compliance],
    ['Hiệu quả công việc', input.efficiency],
  ] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw new BadRequestException(`${label} phải từ 0 đến 100%`);
  }
  return { quality: round2(input.quality), compliance: round2(input.compliance), efficiency: round2(input.efficiency) };
}

/** Điểm đánh giá (0–1) = (a + b + c) / 3. */
export function supportRate(s: SupportScores): number {
  return Math.round(((s.quality + s.compliance + s.efficiency) / 300) * 10_000) / 10_000;
}

/** Điểm kết quả thực hiện nhiệm vụ trên thang 70. */
export function supportResultScore(s: SupportScores): number {
  return round2(Math.min(RESULT_MAX, supportRate(s) * RESULT_MAX));
}
