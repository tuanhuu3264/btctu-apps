import type { AssignmentView, Okr } from '@/lib/api';

/** Một dòng theo dõi: một kết quả then chốt cùng số liệu của các việc đã gắn vào nó (ADR-034). */
export interface KeyResultRow {
  key: string;
  /** Nhãn hiển thị; null là dòng "chưa gắn". */
  label: string | null;
  /** Mã đã gắn nhưng không còn trong OKR hiện tại của vị trí. */
  stale: boolean;
  total: number;
  done: number;
  pending: number;
  inProgress: number;
  overdue: number;
  /** Số lần xác nhận chậm hạn. */
  late: number;
  /** Số lần chưa đạt (sai sót lớn). */
  rework: number;
}

const codeOf = (label: string) => label.split(':')[0];

const emptyRow = (key: string, label: string | null, stale = false): KeyResultRow => ({
  key,
  label,
  stale,
  total: 0,
  done: 0,
  pending: 0,
  inProgress: 0,
  overdue: 0,
  late: 0,
  rework: 0,
});

/**
 * Gom việc đã giao theo kết quả then chốt của người nhận. Việc đã hủy không tính. Mọi kết quả then chốt hiện có đều có dòng,
 * kể cả khi chưa có việc nào, để thấy kết quả chưa được giao việc. Chỉ để theo dõi, không tính điểm.
 */
export function summarizeKeyResults(okr: Okr | null, views: readonly AssignmentView[]): KeyResultRow[] {
  const rows = new Map<string, KeyResultRow>();
  for (const k of okr?.keyResults ?? []) rows.set(k.code, emptyRow(k.code, `${k.code}: ${k.text}`));

  for (const v of views) {
    if (v.state === 'CANCELLED') continue;
    const label = v.assignment.okrKeyResult;
    const key = label ? codeOf(label) : '';
    let row = rows.get(key);
    if (!row) {
      row = label ? emptyRow(key, label, true) : emptyRow('', null);
      rows.set(key, row);
    }
    row.total += 1;
    if (v.state === 'DONE') row.done += 1;
    else if (v.state === 'PENDING_CONFIRM') row.pending += 1;
    else if (v.state === 'OVERDUE') row.overdue += 1;
    else row.inProgress += 1;
    row.late += v.summary.lateCount;
    row.rework += v.summary.reworkCount;
  }
  // Dòng "chưa gắn" xếp cuối.
  return [...rows.values()].sort((a, b) => Number(a.label === null) - Number(b.label === null));
}
