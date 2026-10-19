import type { AssignmentView } from './tasking.service.js';

/**
 * Cảnh báo sớm (PLAN sáng tạo, mục 3): tìm việc có nguy cơ chậm trước khi chậm, bằng quy tắc đơn giản trên số liệu có sẵn,
 * để cấp trên nhắc kịp thời và cán bộ tự điều chỉnh. Không phải dự báo thống kê và không đổi điểm: chậm thật vẫn tính theo
 * Nghị định 335 Điều 14.2.c khi việc được xác nhận hoàn thành sau hạn.
 */
export type WarningLevel = 'HIGH' | 'MEDIUM';
export type WarningKind = 'OVERDUE' | 'DUE_SOON' | 'BEHIND_PACE';

export interface WarningThresholds {
  /** Còn không quá chừng này ngày thì coi là sắp đến hạn. */
  dueSoonDays: number;
  /** Dưới mức hoàn thành này mà sắp đến hạn thì nguy cơ cao. */
  dueSoonCriticalPct: number;
  /** Việc kéo dài ít nhất chừng này ngày mới xét tiến độ so với thời gian. */
  paceMinDays: number;
  /** Chênh lệch tối thiểu giữa phần thời gian đã qua và phần đã hoàn thành để cảnh báo. */
  paceGap: number;
}

export const DEFAULT_THRESHOLDS: WarningThresholds = { dueSoonDays: 3, dueSoonCriticalPct: 0.5, paceMinDays: 7, paceGap: 0.4 };

export interface WarningItem {
  assignmentId: string;
  level: WarningLevel;
  kind: WarningKind;
  /** Tên việc (việc đột xuất: tên do người giao đặt; việc danh mục: mã và tên công việc). */
  title: string;
  taskTitle: string;
  assigneePersonId: string;
  /** Họ tên người nhận việc, điền ở lớp dịch vụ (có thể trống). */
  assigneeName?: string;
  dueDate: string;
  /** Số ngày còn lại; âm nếu đã quá hạn. */
  daysLeft: number;
  planned: number;
  /** Đã xác nhận cộng đang chờ xác nhận. */
  done: number;
  /** Tỷ lệ thời gian đã qua và tỷ lệ đã hoàn thành, 0–1. */
  elapsedPct: number;
  donePct: number;
  text: string;
}

export interface EarlyWarning {
  today: string;
  high: number;
  medium: number;
  items: WarningItem[];
  /** Cán bộ có nhiều cảnh báo nhất, để cấp trên biết cần nhắc ai. */
  byAssignee: { personId: string; name?: string; high: number; medium: number }[];
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const pctText = (x: number) => `${Math.round(x * 100)}%`;

export function earlyWarnings(
  views: readonly AssignmentView[],
  today: string,
  createdOn: (v: AssignmentView) => string,
  thresholds: WarningThresholds = DEFAULT_THRESHOLDS,
): EarlyWarning {
  const items: WarningItem[] = [];
  for (const v of views) {
    const a = v.assignment;
    if (v.state !== 'IN_PROGRESS' && v.state !== 'OVERDUE') continue; // chờ xác nhận, hoàn thành, hủy, đề xuất: không cảnh báo
    const planned = a.plannedQuantity;
    const done = v.summary.confirmedQuantity + v.summary.pendingQuantity;
    const donePct = planned > 0 ? Math.min(1, done / planned) : 0;
    const start = createdOn(v);
    const total = Math.max(1, days(start, a.dueDate));
    const elapsedPct = Math.max(0, Math.min(1, days(start, today) / total));
    const daysLeft = days(today, a.dueDate);
    const title = a.source === 'AD_HOC' ? (a.title ?? v.itemName) : `${a.catalogItemCode} ${v.itemName}`;
    const base = { assignmentId: a.id, title: title.length > 120 ? `${title.slice(0, 120)}…` : title, taskTitle: v.task.title, assigneePersonId: a.assigneePersonId, dueDate: a.dueDate, daysLeft, planned, done, elapsedPct, donePct };

    if (v.state === 'OVERDUE') {
      items.push({ ...base, level: 'HIGH', kind: 'OVERDUE', text: `Đã quá hạn ${-daysLeft} ngày, mới đạt ${pctText(donePct)} số lượng` });
    } else if (daysLeft <= thresholds.dueSoonDays) {
      const critical = donePct < thresholds.dueSoonCriticalPct;
      items.push({
        ...base,
        level: critical ? 'HIGH' : 'MEDIUM',
        kind: 'DUE_SOON',
        text: `${daysLeft === 0 ? 'Hết hạn hôm nay' : `Còn ${daysLeft} ngày`}, mới đạt ${pctText(donePct)} số lượng`,
      });
    } else if (total >= thresholds.paceMinDays && elapsedPct - donePct >= thresholds.paceGap) {
      items.push({ ...base, level: 'MEDIUM', kind: 'BEHIND_PACE', text: `Đã qua ${pctText(elapsedPct)} thời gian nhưng mới đạt ${pctText(donePct)} số lượng` });
    }
  }
  items.sort((x, y) => (x.level === y.level ? x.daysLeft - y.daysLeft : x.level === 'HIGH' ? -1 : 1));

  const per = new Map<string, { personId: string; high: number; medium: number }>();
  for (const i of items) {
    const row = per.get(i.assigneePersonId) ?? { personId: i.assigneePersonId, high: 0, medium: 0 };
    if (i.level === 'HIGH') row.high += 1;
    else row.medium += 1;
    per.set(i.assigneePersonId, row);
  }
  return {
    today,
    high: items.filter((i) => i.level === 'HIGH').length,
    medium: items.filter((i) => i.level === 'MEDIUM').length,
    items,
    byAssignee: [...per.values()].sort((a, b) => b.high - a.high || b.medium - a.medium).slice(0, 10),
  };
}
