/** Số thế hệ sao lưu giữ lại theo ngày, tuần, tháng (ADR-058). */
export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 7, weekly: 4, monthly: 12 };

const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/** Tên thư mục sao lưu có dạng YYYYMMDD-HHMMSS (giờ UTC); trả null nếu không đúng dạng. */
export function parseStamp(stamp: string): Date | null {
  const m = STAMP.exec(stamp);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== mo - 1 ? null : date;
}

export function formatStamp(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const weekKey = (d: Date) => {
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return dayKey(monday);
};

/**
 * Các bản sao lưu cần giữ: bản mới nhất của mỗi ngày trong `daily` ngày gần nhất có bản, của mỗi tuần trong `weekly` tuần gần nhất,
 * của mỗi tháng trong `monthly` tháng gần nhất; bản mới nhất luôn được giữ. Tên không đúng dạng bị bỏ qua (không bao giờ bị xóa).
 */
export function selectKeep(stamps: readonly string[], policy: RetentionPolicy): Set<string> {
  const dated = stamps.flatMap((s) => {
    const d = parseStamp(s);
    return d ? [{ stamp: s, date: d }] : [];
  });
  dated.sort((a, b) => b.date.getTime() - a.date.getTime() || b.stamp.localeCompare(a.stamp));
  const keep = new Set<string>();
  if (dated.length > 0) keep.add(dated[0].stamp);
  const pick = (keyOf: (d: Date) => string, limit: number) => {
    const seen = new Set<string>();
    for (const { stamp, date } of dated) {
      const key = keyOf(date);
      if (seen.has(key)) continue;
      if (seen.size >= limit) break;
      seen.add(key);
      keep.add(stamp);
    }
  };
  pick(dayKey, policy.daily);
  pick(weekKey, policy.weekly);
  pick(monthKey, policy.monthly);
  return keep;
}
