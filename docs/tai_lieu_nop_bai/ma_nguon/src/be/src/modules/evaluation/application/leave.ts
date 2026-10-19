/** Lý do nghỉ được miễn tính tháng đánh giá (Nghị định 335 Điều 11.2). */
export type LeaveReason = 'OM' | 'THAI_SAN' | 'KHONG_LUONG' | 'KHAC';

export const LEAVE_REASONS: readonly LeaveReason[] = ['OM', 'THAI_SAN', 'KHONG_LUONG', 'KHAC'];

export const LEAVE_REASON_LABELS: Record<LeaveReason, string> = {
  OM: 'Nghỉ ốm',
  THAI_SAN: 'Nghỉ thai sản',
  KHONG_LUONG: 'Nghỉ việc riêng không lương',
  KHAC: 'Lý do khác có căn cứ',
};

/** Một tháng nghỉ của cán bộ kèm căn cứ (ADR-039). */
export interface LeaveMonth {
  /** Tháng 1 đến 12. */
  month: number;
  reason: LeaveReason;
  /** Căn cứ: số quyết định, giấy xác nhận. */
  note: string | null;
}

export abstract class LeaveRepository {
  abstract monthsOf(personId: string, year: number): Promise<LeaveMonth[]>;
  /** Thay toàn bộ các tháng nghỉ của cán bộ trong năm. */
  abstract replace(personId: string, year: number, months: readonly LeaveMonth[], createdBy: string | null): Promise<void>;
}
