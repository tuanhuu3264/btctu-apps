/**
 * Việc đột xuất, phát sinh ngoài kế hoạch (ADR-046). Nghị định 335/2025/NĐ-CP Điều 18.1.d: việc đột xuất được tính ngoài
 * số nhiệm vụ giao ban đầu và được tính thêm điểm kết quả. Việc loại này không có trong danh mục nên không có hệ số quy
 * đổi: người giao chọn một trong bốn mức độ khó, mỗi mức ứng với một hệ số cố định (so với công việc chuẩn = 1).
 *
 * Để hồ sơ đánh giá gộp được như việc danh mục, mỗi mức có một "mã" ảo `X.L1`..`X.L4` đặt ở cột mã công việc.
 * Mã này không có trong danh mục nên không giao được như việc thường.
 */
export const AD_HOC_LEVELS = [1, 2, 3, 4] as const;
export type AdHocLevel = (typeof AD_HOC_LEVELS)[number];

/** Hệ số quy đổi theo mức độ khó. Chỉnh ở đây (có ADR kèm theo); chưa có văn bản quy định. */
export const AD_HOC_COEFFICIENTS: Readonly<Record<AdHocLevel, number>> = { 1: 0.5, 2: 1, 3: 2, 4: 3 };

export const AD_HOC_LEVEL_NAMES: Readonly<Record<AdHocLevel, string>> = { 1: 'Đơn giản', 2: 'Trung bình', 3: 'Khó', 4: 'Rất khó' };

const PATTERN = /^X\.L([1-4])$/;

export const adHocCode = (level: AdHocLevel): string => `X.L${level}`;

export function adHocLevelOf(code: string): AdHocLevel | null {
  const m = PATTERN.exec(code);
  return m ? (Number(m[1]) as AdHocLevel) : null;
}

export const isAdHocCode = (code: string): boolean => PATTERN.test(code);

export const isAdHocLevel = (value: unknown): value is AdHocLevel => AD_HOC_LEVELS.includes(value as AdHocLevel);

/** Hệ số của một mã việc đột xuất, hoặc null nếu không phải mã đột xuất. */
export function adHocCoefficient(code: string): number | null {
  const level = adHocLevelOf(code);
  return level === null ? null : AD_HOC_COEFFICIENTS[level];
}

/** Tên hiển thị của dòng việc đột xuất trong hồ sơ đánh giá. */
export function adHocLabel(code: string): string | null {
  const level = adHocLevelOf(code);
  return level === null ? null : `Việc đột xuất, mức ${level} (${AD_HOC_LEVEL_NAMES[level].toLowerCase()})`;
}
