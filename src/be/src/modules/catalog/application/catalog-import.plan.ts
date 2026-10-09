import { GROUP_CODE_PATTERN, ITEM_CODE_PATTERN, MAX_COMPLEXITY, MIN_COMPLEXITY } from './catalog.model.js';
import type { DurationMode, DurationUnit } from './catalog.model.js';

/** Một dòng của sheet: chữ hiển thị và công thức (nếu có) của từng ô. */
export interface CatalogSheetRow {
  rowNumber: number;
  cells: string[];
  formulas: (string | null)[];
}

export interface PlannedGroup {
  code: string;
  name: string;
  sortOrder: number;
}

export interface PlannedCatalogItem {
  rowNumber: number;
  code: string;
  groupCode: string;
  name: string;
  productUnits: string | null;
  complexity: number;
  durationMode: DurationMode;
  durationValue: number | null;
  durationUnit: DurationUnit | null;
  points: number | null;
  explanation: string | null;
  sortOrder: number;
}

export interface CatalogImportPlan {
  groups: PlannedGroup[];
  items: PlannedCatalogItem[];
  baselineCode: string | null;
  errors: string[];
  warnings: string[];
}

const clean = (v: unknown): string => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

function parseNumber(text: string): number | null {
  const normalized = clean(text).replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}

function parseDuration(raw: string): { mode: DurationMode; value: number | null; unit: DurationUnit | null } | null {
  const text = clean(raw);
  if (!text) return { mode: 'UNSPECIFIED', value: null, unit: null };
  if (/^thực tế$/i.test(text)) return { mode: 'ACTUAL', value: null, unit: null };
  const hours = parseNumber(text);
  if (hours !== null) return hours > 0 ? { mode: 'LIMITED', value: hours, unit: 'HOUR' } : null;
  const days = /^(\d+(?:[.,]\d+)?)\s*ngày$/i.exec(text);
  if (days) {
    const n = parseNumber(days[1]);
    return n !== null && n > 0 ? { mode: 'LIMITED', value: n, unit: 'DAY' } : null;
  }
  return null;
}

interface Columns {
  code: number;
  name: number;
  product: number;
  complexity: number;
  duration: number;
  points: number;
  coefficient: number;
  explanation: number;
}

function findColumns(rows: CatalogSheetRow[]): { headerIndex: number; cols: Columns } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].cells.map(clean);
    const at = (pred: (c: string) => boolean) => cells.findIndex(pred);
    const cols: Columns = {
      code: at((c) => c.startsWith('Mã')),
      name: at((c) => c.startsWith('Tên công việc')),
      product: at((c) => c.startsWith('Tên sản phẩm')),
      complexity: at((c) => c.startsWith('Phân nhóm')),
      duration: at((c) => c.startsWith('Thời gian')),
      points: at((c) => c.startsWith('Điểm chấm')),
      coefficient: at((c) => c.startsWith('Hệ số')),
      explanation: at((c) => c.startsWith('Diễn giải')),
    };
    if (Object.values(cols).every((v) => v >= 0)) return { headerIndex: i, cols };
  }
  return null;
}

/**
 * Lập kế hoạch nhập từ sheet danh mục sản phẩm công việc (ADR-013 mục 8).
 * Hàm thuần: kiểm tra toàn bộ và gom mọi lỗi. Công việc chuẩn được suy ra từ ô mà công thức
 * "hệ số quy đổi" tham chiếu tới (ví dụ `F5/$F$21` thì chuẩn là công việc ở dòng 21).
 */
export function planCatalogImport(rows: CatalogSheetRow[]): CatalogImportPlan {
  const plan: CatalogImportPlan = { groups: [], items: [], baselineCode: null, errors: [], warnings: [] };
  const found = findColumns(rows);
  if (!found) {
    plan.errors.push('Không tìm thấy dòng tiêu đề (cần cột "Mã", "Tên công việc", "Điểm chấm", "Hệ số"…)');
    return plan;
  }
  const { headerIndex, cols } = found;
  const baselineRefs = new Map<number, number>();
  const coefficientByCode = new Map<string, number | null>();

  for (const row of rows.slice(headerIndex + 1)) {
    const code = clean(row.cells[cols.code]);
    const at = `Dòng ${row.rowNumber}`;

    if (GROUP_CODE_PATTERN.test(code)) {
      plan.groups.push({ code, name: clean(row.cells[cols.name]), sortOrder: plan.groups.length + 1 });
      continue;
    }
    if (!ITEM_CODE_PATTERN.test(code)) continue; // dòng đánh số cột, dòng trống, ghi chú

    const name = clean(row.cells[cols.name]);
    if (!name) {
      plan.errors.push(`${at} (${code}): thiếu tên công việc`);
      continue;
    }
    const complexity = Number.parseInt(clean(row.cells[cols.complexity]), 10);
    if (!Number.isInteger(complexity) || complexity < MIN_COMPLEXITY || complexity > MAX_COMPLEXITY) {
      plan.errors.push(`${at} (${code}): mức độ phức tạp phải từ ${MIN_COMPLEXITY} đến ${MAX_COMPLEXITY}`);
      continue;
    }
    const duration = parseDuration(row.cells[cols.duration] ?? '');
    if (!duration) {
      plan.errors.push(`${at} (${code}): không hiểu thời gian "${clean(row.cells[cols.duration])}"`);
      continue;
    }
    const pointsText = clean(row.cells[cols.points]);
    let points: number | null = null;
    if (pointsText) {
      points = parseNumber(pointsText);
      if (points === null) {
        plan.errors.push(`${at} (${code}): điểm chấm không phải số: "${pointsText}"`);
        continue;
      }
    } else {
      plan.warnings.push(`Công việc ${code} chưa có điểm chấm (cần bổ sung trước khi chấm điểm)`);
    }
    if (duration.mode === 'UNSPECIFIED') plan.warnings.push(`Công việc ${code} chưa nêu thời gian tối đa`);
    if (duration.unit === 'DAY') plan.warnings.push(`Công việc ${code} có thời gian tính theo ngày trong cột giờ ("${clean(row.cells[cols.duration])}"), chưa quy đổi sang giờ`);

    const formula = row.formulas[cols.coefficient];
    const ref = formula ? /\$[A-Z]+\$(\d+)/.exec(formula) : null;
    if (ref) baselineRefs.set(Number(ref[1]), (baselineRefs.get(Number(ref[1])) ?? 0) + 1);
    coefficientByCode.set(code, parseNumber(clean(row.cells[cols.coefficient])));

    plan.items.push({
      rowNumber: row.rowNumber,
      code,
      groupCode: code[0],
      name,
      productUnits: clean(row.cells[cols.product]) || null,
      complexity,
      durationMode: duration.mode,
      durationValue: duration.value,
      durationUnit: duration.unit,
      points,
      explanation: clean(row.cells[cols.explanation]) || null,
      sortOrder: plan.items.length + 1,
    });
  }

  const seen = new Set<string>();
  for (const item of plan.items) {
    if (seen.has(item.code)) plan.errors.push(`Mã công việc bị trùng: ${item.code}`);
    seen.add(item.code);
  }
  const groupCodes = new Set(plan.groups.map((g) => g.code));
  for (const code of new Set(plan.items.map((i) => i.groupCode))) {
    if (!groupCodes.has(code)) plan.errors.push(`Có công việc nhóm ${code} nhưng không có dòng tiêu đề nhóm ${code}`);
  }
  for (const g of plan.groups) {
    if (!GROUP_CODE_PATTERN.test(g.code) || !g.name) plan.errors.push(`Nhóm ${g.code} không hợp lệ hoặc thiếu tên`);
  }
  if (plan.items.length === 0) plan.errors.push('Không có công việc nào hợp lệ');

  plan.baselineCode = detectBaseline(plan, baselineRefs, coefficientByCode);
  if (plan.baselineCode) {
    const baseline = plan.items.find((i) => i.code === plan.baselineCode)!;
    if (baseline.points === null || baseline.points <= 0) {
      plan.errors.push(`Công việc chuẩn ${baseline.code} không có điểm chấm lớn hơn 0`);
    }
  } else if (plan.items.length > 0) {
    plan.warnings.push('Không xác định được công việc chuẩn (không thấy công thức hệ số tham chiếu), cần chọn thủ công');
  }
  return plan;
}

function detectBaseline(
  plan: CatalogImportPlan,
  refs: Map<number, number>,
  coefficientByCode: Map<string, number | null>,
): string | null {
  const byRow = [...refs.entries()].sort((a, b) => b[1] - a[1]);
  if (byRow.length > 0) {
    const item = plan.items.find((i) => i.rowNumber === byRow[0][0]);
    if (item) return item.code;
    plan.warnings.push(`Công thức hệ số tham chiếu dòng ${byRow[0][0]} nhưng dòng đó không phải công việc`);
  }
  // Dự phòng: đúng một công việc có hệ số ghi bằng 1.
  const ones = plan.items.filter((i) => coefficientByCode.get(i.code) === 1);
  return ones.length === 1 ? ones[0].code : null;
}
