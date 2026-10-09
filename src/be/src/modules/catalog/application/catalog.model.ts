/** Mã nhóm: một chữ cái in hoa A–Z (ADR-020). */
export const GROUP_CODE_PATTERN = /^[A-Z]$/;
export const MAX_GROUPS = 26;
export const MIN_COMPLEXITY = 1;
export const MAX_COMPLEXITY = 4;
/** Mã công việc: chữ cái nhóm, dấu chấm, 3 chữ số (ví dụ A.001). */
export const ITEM_CODE_PATTERN = /^[A-Z]\.\d{3}$/;

/** Tên nhiệm vụ mặc định của mỗi nhóm: nơi chứa công việc khi chưa phân nhiệm vụ (ADR-019). */
export const DEFAULT_TASK_NAME = 'Chưa phân nhiệm vụ';

export interface CatalogGroupModel {
  code: string;
  name: string;
  sortOrder: number;
}

export type VersionStatus = 'DRAFT' | 'APPROVED';

export interface CatalogVersionModel {
  id: string;
  /** Tên danh mục, ví dụ "Danh mục công việc của Ban Tổ chức Tỉnh ủy". */
  name: string;
  /** Nhãn phiên bản: mã ngắn, duy nhất, ví dụ "BTCTU 27.9.2026". */
  label: string;
  status: VersionStatus;
  /** Mã công việc chuẩn: điểm của nó là mẫu số của hệ số quy đổi (ADR-013 mục 4). */
  baselineItemCode: string | null;
  effectiveFrom: Date | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  sourceNote: string | null;
}
export type NewCatalogVersion = Pick<CatalogVersionModel, 'name' | 'label' | 'baselineItemCode' | 'sourceNote'>;

/** LIMITED: có hạn mức (giá trị và đơn vị); ACTUAL: "Thực tế"; UNSPECIFIED: để trống. */
export type DurationMode = 'LIMITED' | 'ACTUAL' | 'UNSPECIFIED';
export type DurationUnit = 'HOUR' | 'DAY';

/** Nhiệm vụ của danh mục: tầng giữa Nhóm → Nhiệm vụ → Công việc (ADR-019). */
export interface CatalogTaskModel {
  id: string;
  versionId: string;
  groupCode: string;
  name: string;
  description: string | null;
  sortOrder: number;
}
export type NewCatalogTask = Omit<CatalogTaskModel, 'id'>;
export type CatalogTaskPatch = Partial<Pick<CatalogTaskModel, 'name' | 'description'>>;

export interface CatalogTaskView extends CatalogTaskModel {
  itemCount: number;
}

export interface CatalogItemModel {
  id: string;
  versionId: string;
  /** Nhiệm vụ chứa công việc; cùng phiên bản và cùng nhóm. */
  taskId: string;
  code: string;
  groupCode: string;
  name: string;
  /** Tên sản phẩm / đơn vị đếm, nguyên văn (ví dụ "Văn bản; Dấu"). */
  productUnits: string | null;
  complexity: number;
  durationMode: DurationMode;
  durationValue: number | null;
  durationUnit: DurationUnit | null;
  /** null: chưa có định mức, cần bổ sung. */
  points: number | null;
  explanation: string | null;
  sortOrder: number;
}
export type NewCatalogItem = Omit<CatalogItemModel, 'id'>;
export type CatalogItemPatch = Partial<
  Omit<CatalogItemModel, 'id' | 'versionId' | 'code' | 'groupCode'>
>;

/** Hệ số quy đổi = điểm chấm / điểm của công việc chuẩn. Rỗng nếu thiếu một trong hai. */
export function coefficientOf(points: number | null, baselinePoints: number | null): number | null {
  if (points === null || baselinePoints === null || baselinePoints <= 0) return null;
  return points / baselinePoints;
}

/** Phạm vi áp dụng của một công việc: đơn vị và vị trí được giao (ADR-021). Rỗng cả hai là việc chung. */
export interface CatalogScope {
  unitIds: string[];
  positionIds: string[];
}

/** Một dòng phạm vi trong kho dữ liệu: đúng một trong hai (đơn vị hoặc vị trí). */
export interface CatalogScopeRow {
  itemId: string;
  unitId: string | null;
  positionId: string | null;
}

export interface CatalogItemView extends CatalogItemModel, CatalogScope {
  coefficient: number | null;
  needsScoring: boolean;
}

export interface CatalogVersionView {
  version: CatalogVersionModel;
  groups: CatalogGroupModel[];
  tasks: CatalogTaskView[];
  baseline: { code: string; points: number } | null;
  items: CatalogItemView[];
  warnings: string[];
}
