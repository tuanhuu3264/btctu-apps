import type { AssignmentSource, PeriodMode, ReportKind } from './tasking.model.js';

/** Tần suất của việc lặp. Lần lặp rơi vào ngày đầu của chu kỳ: thứ Hai, ngày 1 hằng tháng, đầu quý, 1/1 (ADR-046). */
export const RECURRING_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number];
export type TemplateStatus = 'ACTIVE' | 'INACTIVE';

/** Mẫu việc lặp: đến mỗi lần lặp, hệ thống giao một việc theo mẫu cho người nhận. */
export interface RecurringTemplateModel {
  id: string;
  assigneePersonId: string;
  taskId: string;
  source: AssignmentSource;
  /** Mã công việc trong danh mục, hoặc mã ảo X.L1..X.L4 với việc đột xuất. */
  catalogItemCode: string;
  /** Tên việc đột xuất; null với việc từ danh mục. */
  title: string | null;
  plannedQuantity: number;
  frequency: RecurringFrequency;
  /** Ngày bắt đầu hiệu lực, dạng YYYY-MM-DD. Lần lặp đầu tiên là ngày đầu chu kỳ không sớm hơn ngày này. */
  startDate: string;
  endDate: string | null;
  /** Hạn hoàn thành = ngày lặp + số ngày này. */
  dueAfterDays: number;
  periodMode: PeriodMode;
  reportKinds: ReportKind[];
  note: string | null;
  approverPersonId: string | null;
  status: TemplateStatus;
  createdBy: string;
  createdAt: Date;
  inactiveAt: Date | null;
  lastRunAt: Date | null;
  lastError: string | null;
}
export type NewRecurringTemplate = Omit<RecurringTemplateModel, 'id' | 'status' | 'createdAt' | 'inactiveAt' | 'lastRunAt' | 'lastError'>;
export type RecurringTemplatePatch = Partial<
  Pick<RecurringTemplateModel, 'plannedQuantity' | 'startDate' | 'endDate' | 'dueAfterDays' | 'note' | 'approverPersonId' | 'title' | 'catalogItemCode' | 'status' | 'inactiveAt' | 'lastRunAt' | 'lastError'>
>;

/** Số lần lặp tối đa sinh trong một lượt chạy: chặn bùng nổ khi mẫu có ngày bắt đầu quá xa; phần còn lại sinh ở lượt sau. */
export const MAX_OCCURRENCES_PER_RUN = 24;

const DAY_MS = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDaysIso = (date: string, days: number): string => iso(ms(date) + days * DAY_MS);

function ymd(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}
const make = (y: number, m: number) => iso(Date.UTC(y, m - 1, 1)); // `Date.UTC` tự cuộn tháng vượt 12 sang năm sau

/** Lần lặp đầu tiên không sớm hơn `from`. */
export function firstOccurrenceOnOrAfter(frequency: RecurringFrequency, from: string): string {
  const { y, m, d } = ymd(from);
  switch (frequency) {
    case 'WEEKLY': {
      const dow = new Date(ms(from)).getUTCDay(); // 0 = Chủ nhật
      return addDaysIso(from, (1 - dow + 7) % 7);
    }
    case 'MONTHLY':
      return d === 1 ? from : make(y, m + 1);
    case 'QUARTERLY': {
      if (d === 1 && (m - 1) % 3 === 0) return from;
      const quarterStart = m - ((m - 1) % 3); // tháng đầu quý hiện tại
      return make(y, quarterStart + 3);
    }
    case 'YEARLY':
      return d === 1 && m === 1 ? from : make(y + 1, 1);
  }
}

/** Lần lặp kế tiếp sau một lần lặp. */
export function nextOccurrence(frequency: RecurringFrequency, occurrence: string): string {
  const { y, m } = ymd(occurrence);
  switch (frequency) {
    case 'WEEKLY':
      return addDaysIso(occurrence, 7);
    case 'MONTHLY':
      return make(y, m + 1);
    case 'QUARTERLY':
      return make(y, m + 3);
    case 'YEARLY':
      return make(y + 1, 1);
  }
}

/**
 * Các lần lặp từ ngày bắt đầu đến hôm nay (và trước ngày kết thúc nếu có), theo thứ tự thời gian, tối đa `limit` lần.
 * Là hàm thuần của ngày, không phụ thuộc lần chạy trước: chạy bù sau khi hệ thống tắt chỉ cần gọi lại.
 */
export function occurrencesUpTo(t: Pick<RecurringTemplateModel, 'frequency' | 'startDate' | 'endDate'>, today: string, limit = MAX_OCCURRENCES_PER_RUN): string[] {
  const out: string[] = [];
  for (let occ = firstOccurrenceOnOrAfter(t.frequency, t.startDate); occ <= today && (t.endDate === null || occ <= t.endDate) && out.length < limit; occ = nextOccurrence(t.frequency, occ)) {
    out.push(occ);
  }
  return out;
}
