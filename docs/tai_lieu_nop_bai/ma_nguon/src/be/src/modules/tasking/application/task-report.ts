import type { TableExport, TableSheet } from '../../../common/table-export.js';
import type { AssignmentView } from './tasking.service.js';
import type { AssignmentState } from './tasking.model.js';

/** Nhãn trạng thái việc, dùng cho tệp xuất (khớp nhãn ở giao diện). */
export const STATE_TEXT: Record<AssignmentState, string> = {
  PROPOSED: 'Chờ duyệt đề xuất',
  IN_PROGRESS: 'Đang thực hiện',
  PENDING_CONFIRM: 'Chờ xác nhận',
  OVERDUE: 'Quá hạn',
  DONE: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
};

/** Tên cán bộ và vị trí để ghép vào tệp xuất. */
export interface TaskLookup {
  persons: Map<string, { fullName: string }>;
  positions: Map<string, { title: string; unitName: string }>;
}

/** Tên công việc trong danh mục có thể dài hàng nghìn chữ (liệt kê mọi thao tác): chỉ lấy đủ để nhận ra, mã công việc đứng trước. */
export const shorten = (text: string, max = 120): string => (text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`);

/** Trạng thái được tính vào tỷ lệ: việc đã hủy và đề xuất chưa duyệt không tính. */
const COUNTED: readonly AssignmentState[] = ['IN_PROGRESS', 'PENDING_CONFIRM', 'OVERDUE', 'DONE'];

export interface TaskGroupStats {
  total: number;
  done: number;
  overdue: number;
  /** Số việc chậm: quá hạn, hoặc có lần báo cáo hoàn thành sau hạn. */
  late: number;
  /** Số việc có ít nhất một lần chưa đạt (bị từ chối vì sai sót lớn). */
  rework: number;
  /** late / total, null nếu chưa có việc. */
  lateRate: number | null;
  reworkRate: number | null;
}

export interface TaskStatistics {
  byState: Record<AssignmentState, number>;
  overall: TaskGroupStats;
  byUnit: ({ unitName: string } & TaskGroupStats)[];
}

const ratio = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 10_000) / 10_000);

function groupStats(views: readonly AssignmentView[]): TaskGroupStats {
  const counted = views.filter((v) => COUNTED.includes(v.state));
  const late = counted.filter((v) => v.state === 'OVERDUE' || v.summary.lateCount > 0).length;
  const rework = counted.filter((v) => v.summary.reworkCount > 0).length;
  return {
    total: counted.length,
    done: counted.filter((v) => v.state === 'DONE').length,
    overdue: counted.filter((v) => v.state === 'OVERDUE').length,
    late,
    rework,
    lateRate: ratio(late, counted.length),
    reworkRate: ratio(rework, counted.length),
  };
}

/** Thống kê một tập việc: theo trạng thái, chung, và theo đơn vị của vị trí mà việc thuộc về (ADR-047). */
export function taskStatistics(views: readonly AssignmentView[], lookup: TaskLookup): TaskStatistics {
  const byState = Object.fromEntries(Object.keys(STATE_TEXT).map((s) => [s, 0])) as Record<AssignmentState, number>;
  for (const v of views) byState[v.state] += 1;
  const byUnitMap = new Map<string, AssignmentView[]>();
  for (const v of views) {
    const unit = (v.assignment.positionId ? lookup.positions.get(v.assignment.positionId)?.unitName : undefined) ?? '(chưa rõ đơn vị)';
    byUnitMap.set(unit, [...(byUnitMap.get(unit) ?? []), v]);
  }
  const byUnit = [...byUnitMap]
    .map(([unitName, list]) => ({ unitName, ...groupStats(list) }))
    .sort((a, b) => a.unitName.localeCompare(b.unitName, 'vi'));
  return { byState, overall: groupStats(views), byUnit };
}

const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1).replace('.', ',')}%`);

/** Bảng thống kê dưới dạng các trang tính để xuất kèm danh sách (A6.4). */
export function statisticsSheets(stats: TaskStatistics): TableSheet[] {
  const o = stats.overall;
  return [
    {
      name: 'Thống kê chung',
      heading: 'Thống kê theo trạng thái (tỷ lệ tính trên việc đang thực hiện, chờ xác nhận, quá hạn, hoàn thành)',
      columns: [{ header: 'Chỉ tiêu', width: 42 }, { header: 'Giá trị', width: 14, align: 'right' }],
      rows: [
        ...(Object.keys(STATE_TEXT) as AssignmentState[]).map((s): [string, number] => [STATE_TEXT[s], stats.byState[s]]),
        ['Tổng số việc tính tỷ lệ', o.total],
        ['Số việc chậm (quá hạn hoặc báo cáo sau hạn)', o.late],
        ['Tỷ lệ việc chậm', pct(o.lateRate)],
        ['Số việc có lần chưa đạt', o.rework],
        ['Tỷ lệ việc chưa đạt', pct(o.reworkRate)],
      ],
    },
    {
      name: 'Theo đơn vị',
      heading: 'Thống kê theo đơn vị',
      columns: [
        { header: 'Đơn vị', width: 36 },
        { header: 'Số việc', width: 10, align: 'right' },
        { header: 'Hoàn thành', width: 12, align: 'right' },
        { header: 'Quá hạn', width: 10, align: 'right' },
        { header: 'Việc chậm', width: 11, align: 'right' },
        { header: 'Tỷ lệ chậm', width: 11, align: 'right' },
        { header: 'Chưa đạt', width: 10, align: 'right' },
        { header: 'Tỷ lệ chưa đạt', width: 13, align: 'right' },
      ],
      rows: stats.byUnit.map((u) => [u.unitName, u.total, u.done, u.overdue, u.late, pct(u.lateRate), u.rework, pct(u.reworkRate)]),
    },
  ];
}

/** Tệp xuất danh sách việc: một trang danh sách và hai trang thống kê. */
export function buildTaskExport(views: readonly AssignmentView[], lookup: TaskLookup, info: [string, string][], generatedAt: Date): TableExport {
  const name = (id: string | null) => (id ? (lookup.persons.get(id)?.fullName ?? '(không rõ)') : '');
  const list: TableSheet = {
    name: 'Danh sách việc',
    columns: [
      { header: 'STT', width: 6, align: 'right' },
      { header: 'Nhiệm vụ', width: 28 },
      { header: 'Công việc', width: 34 },
      { header: 'Loại', width: 12 },
      { header: 'Cán bộ nhận việc', width: 22 },
      { header: 'Vị trí', width: 24 },
      { header: 'Đơn vị', width: 24 },
      { header: 'Người xác nhận', width: 22 },
      { header: 'SL giao', width: 9, align: 'right' },
      { header: 'SL đã xác nhận', width: 11, align: 'right' },
      { header: 'Hạn', width: 12 },
      { header: 'Trạng thái', width: 16 },
      { header: 'Số lần chậm', width: 9, align: 'right' },
      { header: 'Số lần chưa đạt', width: 10, align: 'right' },
    ],
    rows: views.map((v, i) => {
      const a = v.assignment;
      const position = a.positionId ? lookup.positions.get(a.positionId) : undefined;
      return [
        i + 1,
        v.task.title,
        a.source === 'AD_HOC' ? v.itemName : `${a.catalogItemCode} ${shorten(v.itemName)}`,
        a.source === 'AD_HOC' ? `Đột xuất (mức ${v.adHocLevel})` : a.recurringTemplateId ? 'Định kỳ' : 'Danh mục',
        name(a.assigneePersonId),
        position?.title ?? '',
        position?.unitName ?? '',
        name(v.confirmerPersonId),
        a.plannedQuantity,
        v.summary.confirmedQuantity,
        a.dueDate,
        STATE_TEXT[v.state],
        v.summary.lateCount,
        v.summary.reworkCount,
      ];
    }),
  };
  return { title: 'DANH SÁCH VIỆC ĐƯỢC GIAO', info, generatedAt, sheets: [list, ...statisticsSheets(taskStatistics(views, lookup))] };
}
