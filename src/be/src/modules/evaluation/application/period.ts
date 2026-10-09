import { BadRequestException } from '@nestjs/common';
import type { PeriodType } from './evaluation.model.js';

export interface PeriodSpec {
  type: PeriodType;
  year: number;
  number: number | null;
  label: string;
  startDate: string;
  endDate: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Tính nhãn và khoảng ngày của kỳ. Quý chỉ có I–III: quý IV không có xếp loại riêng, được gộp vào
 * đánh giá năm (05-HD/TU mục III.6). Dùng số học UTC để không lệch ngày theo múi giờ.
 */
export function buildPeriod(type: PeriodType, year: number, number?: number | null): PeriodSpec {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Năm phải từ 2000 đến 2100');

  if (type === 'YEAR') {
    if (number != null) throw new BadRequestException('Kỳ năm không có số thứ tự');
    return { type, year, number: null, label: `${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }
  if (number == null || !Number.isInteger(number)) throw new BadRequestException('Thiếu số thứ tự của kỳ');

  if (type === 'MONTH') {
    if (number < 1 || number > 12) throw new BadRequestException('Tháng phải từ 1 đến 12');
    return {
      type,
      year,
      number,
      label: `${year}-M${pad(number)}`,
      startDate: `${year}-${pad(number)}-01`,
      endDate: `${year}-${pad(number)}-${pad(lastDayOf(year, number))}`,
    };
  }

  if (number === 4) {
    throw new BadRequestException('Không đánh giá riêng quý IV: kết quả quý IV được gộp vào đánh giá năm (05-HD/TU)');
  }
  if (number < 1 || number > 3) throw new BadRequestException('Quý phải từ 1 đến 3');
  const lastMonth = number * 3;
  return {
    type,
    year,
    number,
    label: `${year}-Q${number}`,
    startDate: `${year}-${pad(lastMonth - 2)}-01`,
    endDate: `${year}-${pad(lastMonth)}-${pad(lastDayOf(year, lastMonth))}`,
  };
}
