import { MAX_LEVEL, MIN_LEVEL } from './org.model.js';
import type { UnitType } from './unit.model.js';

export interface PlannedUnit {
  code: string;
  name: string;
  type: UnitType;
  parentCode: string | null;
}

export interface PlannedPosition {
  code: string;
  unitCode: string;
  title: string;
  level: number;
  reportsToCode: string | null;
  duties: string | null;
  referenceOkr: string | null;
  /** null: vị trí còn trống. */
  holderName: string | null;
}

export interface OrgImportPlan {
  units: PlannedUnit[];
  positions: PlannedPosition[];
  errors: string[];
}

/** Cơ cấu đơn vị cố định của Ban (Quy định 01-QĐ/BTCTU): Ban và 4 phòng. */
export const UNIT_DEFINITIONS: readonly PlannedUnit[] = [
  { code: 'BTCTU', name: 'Ban Tổ chức Tỉnh ủy', type: 'BAN', parentCode: null },
  { code: 'TCCB', name: 'Phòng Tổ chức cán bộ', type: 'PHONG', parentCode: 'BTCTU' },
  { code: 'VP', name: 'Văn phòng', type: 'PHONG', parentCode: 'BTCTU' },
  { code: 'TCDDV', name: 'Phòng Tổ chức đảng, đảng viên', type: 'PHONG', parentCode: 'BTCTU' },
  { code: 'BVCTNB', name: 'Phòng Bảo vệ chính trị nội bộ', type: 'PHONG', parentCode: 'BTCTU' },
];

const BAN_CODE = 'BTCTU';
const DEPARTMENT_TO_UNIT: Readonly<Record<string, string>> = {
  'Phòng Tổ chức cán bộ': 'TCCB',
  'Văn phòng': 'VP',
  'Phòng Tổ chức đảng, đảng viên': 'TCDDV',
  'Phòng Bảo vệ chính trị nội bộ': 'BVCTNB',
};
/** Dòng "(Vị trí) …" là vị trí chưa có người giữ. */
const VACANT_PREFIX = /^\(\s*Vị trí\s*\)\s*/i;

export const ORG_SHEET_NAME = '02.Danh_sach_toan_Ban';

const clean = (v: unknown): string => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

/** Bỏ dấu, viết hoa, chỉ giữ chữ số và gạch nối: dùng làm mã ổn định. */
export function slug(text: string): string {
  return clean(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface Columns {
  level: number;
  department: number;
  title: number;
  name: number;
  manager: number;
  duties: number;
  okr: number;
}

function findColumns(rows: string[][]): { headerIndex: number; cols: Columns } | null {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(clean);
    if (!cells.includes('Họ và tên') || !cells.includes('Chức vụ')) continue;
    const at = (pred: (c: string) => boolean) => cells.findIndex(pred);
    const cols: Columns = {
      level: at((c) => c === 'Cấp'),
      department: at((c) => c === 'Phòng / đơn vị'),
      title: at((c) => c === 'Chức vụ'),
      name: at((c) => c === 'Họ và tên'),
      manager: at((c) => c.startsWith('Cấp quản lý trực tiếp')),
      duties: at((c) => c.startsWith('Lĩnh vực')),
      okr: at((c) => c.startsWith('KPI')),
    };
    if (Object.values(cols).every((v) => v >= 0)) return { headerIndex: i, cols };
  }
  return null;
}

/**
 * Lập kế hoạch nhập từ bảng "Danh sách cán bộ, công chức theo vị trí việc làm" (ADR-012).
 * Hàm thuần: kiểm tra toàn bộ tệp và gom mọi lỗi, không ghi gì.
 */
export function planOrgImport(rows: string[][]): OrgImportPlan {
  const errors: string[] = [];
  const found = findColumns(rows);
  if (!found) {
    return { units: [...UNIT_DEFINITIONS], positions: [], errors: ['Không tìm thấy dòng tiêu đề (cần cột "Cấp", "Chức vụ", "Họ và tên"…)'] };
  }
  const { headerIndex, cols } = found;

  interface Row extends PlannedPosition {
    line: number;
    managerName: string;
  }
  const parsed: Row[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 1;
    const level = Number.parseInt(clean(r[cols.level]), 10);
    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) continue; // dòng ghi chú, dòng trống

    const rawName = clean(r[cols.name]);
    const title = clean(r[cols.title]);
    if (!rawName || !title) {
      errors.push(`Dòng ${line}: thiếu họ tên hoặc chức vụ`);
      continue;
    }

    let unitCode = BAN_CODE;
    if (level > 2) {
      const dept = clean(r[cols.department]);
      const mapped = DEPARTMENT_TO_UNIT[dept];
      if (!mapped) {
        errors.push(`Dòng ${line}: không nhận ra đơn vị "${dept}"`);
        continue;
      }
      unitCode = mapped;
    }

    const vacant = VACANT_PREFIX.test(rawName);
    const subject = vacant ? rawName.replace(VACANT_PREFIX, '') : rawName;
    parsed.push({
      line,
      code: `${unitCode}-L${level}-${slug(subject)}`,
      unitCode,
      title: vacant ? `${title} – ${subject}` : title,
      level,
      reportsToCode: null,
      duties: clean(r[cols.duties]) || null,
      referenceOkr: clean(r[cols.okr]) || null,
      holderName: vacant ? null : rawName,
      managerName: clean(r[cols.manager]),
    });
  }

  if (parsed.length === 0) errors.push('Không có dòng dữ liệu nào hợp lệ');

  const codeCount = new Map<string, number>();
  for (const p of parsed) codeCount.set(p.code, (codeCount.get(p.code) ?? 0) + 1);
  for (const [code, n] of codeCount) if (n > 1) errors.push(`Mã vị trí bị trùng ${n} lần: ${code}`);

  const holders = new Map<string, Row[]>();
  for (const p of parsed) {
    if (!p.holderName) continue;
    holders.set(p.holderName, [...(holders.get(p.holderName) ?? []), p]);
  }
  for (const [name, list] of holders) {
    if (list.length > 1) errors.push(`Họ tên xuất hiện ở ${list.length} dòng (${list.map((p) => p.line).join(', ')}): ${name}`);
  }

  for (const p of parsed) {
    if (p.level === MIN_LEVEL) continue; // cấp trên của cấp 1 nằm ngoài Ban (Tỉnh ủy, Ban Tổ chức Trung ương)
    const candidates = holders.get(p.managerName) ?? [];
    if (candidates.length !== 1) {
      errors.push(`Dòng ${p.line}: không xác định được cấp trên "${p.managerName}"`);
      continue;
    }
    const manager = candidates[0];
    if (manager.level >= p.level) {
      errors.push(`Dòng ${p.line}: cấp trên "${p.managerName}" (cấp ${manager.level}) không thấp số cấp hơn (cấp ${p.level})`);
      continue;
    }
    p.reportsToCode = manager.code;
  }

  const positions: PlannedPosition[] = parsed.map(({ line: _line, managerName: _manager, ...position }) => position);
  return { units: [...UNIT_DEFINITIONS], positions, errors };
}
