import { BadRequestException } from '@nestjs/common';
import type { PeriodModel } from './evaluation.model.js';

/** Còn từ ngần này ngày trở xuống thì nhắc (ADR-038 mục 9). */
export const REMINDER_DAYS = 14;

/** Tình trạng hạn hoàn thành đánh giá, xếp loại của kỳ năm (Nghị định 335 Điều 9.1, 15.2). */
export interface DeadlineStatus {
  /** Ngày hạn đang áp dụng, YYYY-MM-DD. */
  date: string;
  /** Hạn mặc định 15/12; ngày khác là đã gia hạn. */
  extended: boolean;
  /** Số ngày còn lại; âm là đã quá hạn. */
  daysLeft: number;
  overdue: boolean;
  /** Còn trong khoảng nhắc việc. */
  reminder: boolean;
}

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Hạn mặc định: 15 tháng 12 của năm đánh giá. */
export const defaultDeadline = (year: number): string => `${year}-12-15`;
/** Hạn xa nhất theo trường hợp đặc biệt: 15 tháng 01 năm sau. */
export const latestDeadline = (year: number): string => `${year + 1}-01-15`;

const utcDay = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Ngày theo giờ Việt Nam (UTC+7), để hạn không lệch một ngày vì múi giờ máy chủ. */
export const todayVn = (now: Date): string => {
  const t = new Date(now.getTime() + 7 * 3_600_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

/** Hạn của kỳ năm; kỳ tháng, quý không có hạn này nên trả null. */
export function deadlineStatus(period: Pick<PeriodModel, 'type' | 'year' | 'ratingDeadline'>, now: Date): DeadlineStatus | null {
  if (period.type !== 'YEAR') return null;
  const date = period.ratingDeadline ?? defaultDeadline(period.year);
  const daysLeft = Math.round((utcDay(date) - utcDay(todayVn(now))) / DAY_MS);
  return { date, extended: date !== defaultDeadline(period.year), daysLeft, overdue: daysLeft < 0, reminder: daysLeft <= REMINDER_DAYS };
}

/** Lời cảnh báo hiển thị trên hồ sơ năm chưa xong; null khi chưa cần nhắc. */
export function deadlineWarning(status: DeadlineStatus | null): string | null {
  if (!status || !status.reminder) return null;
  const dmy = status.date.split('-').reverse().join('/');
  if (status.overdue) return `Đã quá hạn hoàn thành đánh giá, xếp loại ${-status.daysLeft} ngày (hạn ${dmy}, Nghị định 335 Điều 9.1, 15.2). Hệ thống vẫn cho xử lý tiếp; hãy hoàn tất sớm.`;
  return status.daysLeft === 0 ? `Hôm nay là hạn hoàn thành đánh giá, xếp loại (${dmy}).` : `Còn ${status.daysLeft} ngày đến hạn hoàn thành đánh giá, xếp loại (${dmy}).`;
}

/** Kiểm tra hạn mới do Văn phòng đặt: trong khoảng 15/12 đến 15/01 năm sau, kèm lý do khi gia hạn. */
export function validateDeadline(year: number, date: string, reason: string | undefined): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new BadRequestException('Ngày hạn phải có dạng YYYY-MM-DD');
  if (date < defaultDeadline(year) || date > latestDeadline(year)) {
    throw new BadRequestException(`Hạn chỉ được đặt từ 15/12/${year} đến 15/01/${year + 1} (Nghị định 335 Điều 9.1)`);
  }
  if (date !== defaultDeadline(year) && (reason?.trim().length ?? 0) < 3) {
    throw new BadRequestException('Gia hạn sang sau 15/12 là trường hợp đặc biệt, cần nêu căn cứ của cấp có thẩm quyền');
  }
}
