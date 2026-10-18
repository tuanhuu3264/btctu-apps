import type { TableExport, TableSheet } from '../../../common/table-export.js';
import { PROJECT_STATUSES } from './project.model.js';
import type { MilestoneModel, ProjectKind, ProjectModel, ProjectStatus } from './project.model.js';

export const STATUS_TEXT: Record<ProjectStatus, string> = {
  DRAFT: 'Đang soạn',
  SUBMITTED: 'Chờ duyệt',
  ACTIVE: 'Đang thực hiện',
  COMPLETED: 'Đã nghiệm thu',
  CANCELLED: 'Đã hủy',
};
export const KIND_TEXT: Record<ProjectKind, string> = { DE_AN: 'Đề án', DU_AN: 'Dự án' };

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export interface Progress {
  /** Tỷ lệ hoàn thành theo trọng số mốc, 0–1; null khi chưa có mốc nào. */
  ratio: number | null;
  total: number;
  done: number;
  /** Mốc chưa xong mà đã quá hạn tại ngày `today`. */
  overdue: number;
  /** Hạn của mốc chưa xong gần nhất; null nếu không còn mốc nào chưa xong. */
  nextDue: string | null;
}

export function progressOf(milestones: readonly MilestoneModel[], today: string): Progress {
  const weight = milestones.reduce((s, m) => s + m.weight, 0);
  const doneWeight = milestones.filter((m) => m.status === 'DONE').reduce((s, m) => s + m.weight, 0);
  const pending = milestones.filter((m) => m.status !== 'DONE');
  return {
    ratio: weight > 0 ? round4(doneWeight / weight) : null,
    total: milestones.length,
    done: milestones.length - pending.length,
    overdue: pending.filter((m) => m.dueDate < today).length,
    nextDue: pending.map((m) => m.dueDate).sort()[0] ?? null,
  };
}

export interface ProjectSummary {
  project: ProjectModel;
  milestones: readonly MilestoneModel[];
  ownerName: string;
  unitName: string;
}

// ---- thống kê

export interface ProjectStatistics {
  total: number;
  byStatus: Record<ProjectStatus, number>;
  byKind: Record<ProjectKind, number>;
  /** Chỉ tính đề án đang thực hiện. */
  active: { count: number; averageProgress: number | null; withOverdueMilestones: number; overdueMilestones: number; pastEndDate: number };
  byUnit: { unitName: string; total: number; active: number; completed: number }[];
}

export function projectStatistics(items: readonly ProjectSummary[], today: string): ProjectStatistics {
  const byStatus = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, 0])) as Record<ProjectStatus, number>;
  const byKind: Record<ProjectKind, number> = { DE_AN: 0, DU_AN: 0 };
  const units = new Map<string, { unitName: string; total: number; active: number; completed: number }>();
  const ratios: number[] = [];
  let withOverdue = 0;
  let overdueMilestones = 0;
  let pastEnd = 0;
  let activeCount = 0;
  for (const it of items) {
    const p = it.project;
    byStatus[p.status] += 1;
    byKind[p.kind] += 1;
    const row = units.get(it.unitName) ?? { unitName: it.unitName, total: 0, active: 0, completed: 0 };
    row.total += 1;
    if (p.status === 'ACTIVE') row.active += 1;
    if (p.status === 'COMPLETED') row.completed += 1;
    units.set(it.unitName, row);
    if (p.status === 'ACTIVE') {
      activeCount += 1;
      const pr = progressOf(it.milestones, today);
      if (pr.ratio !== null) ratios.push(pr.ratio);
      if (pr.overdue > 0) withOverdue += 1;
      overdueMilestones += pr.overdue;
      if (p.endDate < today) pastEnd += 1;
    }
  }
  return {
    total: items.length,
    byStatus,
    byKind,
    active: {
      count: activeCount,
      averageProgress: ratios.length > 0 ? round4(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null,
      withOverdueMilestones: withOverdue,
      overdueMilestones,
      pastEndDate: pastEnd,
    },
    byUnit: [...units.values()].sort((a, b) => a.unitName.localeCompare(b.unitName, 'vi')),
  };
}

// ---- cảnh báo sớm

export type ProjectWarningKind = 'MILESTONE_OVERDUE' | 'MILESTONE_DUE_SOON' | 'PROJECT_PAST_END';

export interface ProjectWarning {
  level: 'HIGH' | 'MEDIUM';
  kind: ProjectWarningKind;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  ownerPersonId: string;
  ownerName: string;
  milestoneId: string | null;
  milestoneTitle: string | null;
  assigneePersonId: string | null;
  dueDate: string;
  daysLeft: number;
  text: string;
}

export interface ProjectWarnings {
  today: string;
  high: number;
  medium: number;
  items: ProjectWarning[];
}

/** Mốc còn không quá chừng này ngày thì là "sắp đến hạn". */
export const MILESTONE_DUE_SOON_DAYS = 7;

/** Chỉ xét đề án đang thực hiện. Mốc quá hạn và đề án quá ngày kết thúc là nguy cơ cao; mốc sắp đến hạn là cần theo dõi. */
export function projectWarnings(items: readonly ProjectSummary[], today: string, dueSoonDays = MILESTONE_DUE_SOON_DAYS): ProjectWarnings {
  const out: ProjectWarning[] = [];
  for (const it of items) {
    const p = it.project;
    if (p.status !== 'ACTIVE') continue;
    const base = { projectId: p.id, projectCode: p.code, projectTitle: p.title, ownerPersonId: p.ownerPersonId, ownerName: it.ownerName };
    for (const m of it.milestones) {
      if (m.status === 'DONE') continue;
      const daysLeft = days(today, m.dueDate);
      const mile = { milestoneId: m.id, milestoneTitle: m.title, assigneePersonId: m.assigneePersonId, dueDate: m.dueDate, daysLeft };
      if (daysLeft < 0) out.push({ ...base, ...mile, level: 'HIGH', kind: 'MILESTONE_OVERDUE', text: `Mốc "${m.title}" quá hạn ${-daysLeft} ngày` });
      else if (daysLeft <= dueSoonDays) {
        out.push({ ...base, ...mile, level: 'MEDIUM', kind: 'MILESTONE_DUE_SOON', text: `Mốc "${m.title}" ${daysLeft === 0 ? 'hết hạn hôm nay' : `còn ${daysLeft} ngày`}` });
      }
    }
    if (p.endDate < today) {
      const left = days(today, p.endDate);
      out.push({ ...base, milestoneId: null, milestoneTitle: null, assigneePersonId: null, dueDate: p.endDate, daysLeft: left, level: 'HIGH', kind: 'PROJECT_PAST_END', text: `Đã quá ngày kết thúc ${-left} ngày nhưng chưa nghiệm thu` });
    }
  }
  out.sort((a, b) => (a.level === b.level ? a.daysLeft - b.daysLeft : a.level === 'HIGH' ? -1 : 1));
  return { today, high: out.filter((w) => w.level === 'HIGH').length, medium: out.filter((w) => w.level === 'MEDIUM').length, items: out };
}

// ---- xuất tệp

const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1).replace('.', ',')}%`);

export function buildProjectExport(items: readonly ProjectSummary[], names: (personId: string | null) => string, info: [string, string][], today: string, generatedAt: Date): TableExport {
  const list: TableSheet = {
    name: 'Danh sách',
    columns: [
      { header: 'STT', width: 6, align: 'right' },
      { header: 'Mã', width: 14 },
      { header: 'Loại', width: 9 },
      { header: 'Tên đề án, dự án', width: 40 },
      { header: 'Chủ trì', width: 22 },
      { header: 'Đơn vị', width: 22 },
      { header: 'Bắt đầu', width: 12 },
      { header: 'Kết thúc', width: 12 },
      { header: 'Trạng thái', width: 15 },
      { header: 'Tiến độ', width: 9, align: 'right' },
      { header: 'Mốc xong / tổng', width: 11, align: 'right' },
      { header: 'Mốc quá hạn', width: 9, align: 'right' },
    ],
    rows: items.map((it, i) => {
      const pr = progressOf(it.milestones, today);
      const p = it.project;
      return [i + 1, p.code, KIND_TEXT[p.kind], p.title, it.ownerName, it.unitName, p.startDate, p.endDate, STATUS_TEXT[p.status], pct(pr.ratio), `${pr.done}/${pr.total}`, pr.overdue];
    }),
  };
  const milestones: TableSheet = {
    name: 'Mốc tiến độ',
    heading: 'Mốc tiến độ của các đề án, dự án trong danh sách',
    columns: [
      { header: 'Mã đề án', width: 14 },
      { header: 'Mốc', width: 40 },
      { header: 'Phụ trách', width: 22 },
      { header: 'Hạn', width: 12 },
      { header: 'Trọng số', width: 9, align: 'right' },
      { header: 'Trạng thái', width: 12 },
      { header: 'Hoàn thành ngày', width: 14 },
    ],
    rows: items.flatMap((it) =>
      [...it.milestones]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map((m) => [it.project.code, m.title, names(m.assigneePersonId ?? it.project.ownerPersonId), m.dueDate, m.weight, m.status === 'DONE' ? 'Đã xong' : m.dueDate < today ? 'Quá hạn' : 'Chưa xong', m.completedOn ?? '']),
    ),
  };
  const stats = projectStatistics(items, today);
  const summary: TableSheet = {
    name: 'Thống kê',
    heading: 'Thống kê đề án, dự án',
    columns: [{ header: 'Chỉ tiêu', width: 42 }, { header: 'Giá trị', width: 14, align: 'right' }],
    rows: [
      ...PROJECT_STATUSES.map((s): [string, number] => [STATUS_TEXT[s], stats.byStatus[s]]),
      ['Tổng số', stats.total],
      ['Đang thực hiện: tiến độ trung bình', pct(stats.active.averageProgress)],
      ['Đang thực hiện: số đề án có mốc quá hạn', stats.active.withOverdueMilestones],
      ['Đang thực hiện: tổng số mốc quá hạn', stats.active.overdueMilestones],
      ['Đang thực hiện: số đề án quá ngày kết thúc', stats.active.pastEndDate],
    ],
  };
  const byUnit: TableSheet = {
    name: 'Theo đơn vị',
    heading: 'Thống kê theo đơn vị chủ trì',
    columns: [{ header: 'Đơn vị', width: 36 }, { header: 'Tổng', width: 9, align: 'right' }, { header: 'Đang thực hiện', width: 14, align: 'right' }, { header: 'Đã nghiệm thu', width: 14, align: 'right' }],
    rows: stats.byUnit.map((u) => [u.unitName, u.total, u.active, u.completed]),
  };
  return { title: 'DANH SÁCH ĐỀ ÁN, DỰ ÁN', info, generatedAt, sheets: [list, milestones, summary, byUnit] };
}
