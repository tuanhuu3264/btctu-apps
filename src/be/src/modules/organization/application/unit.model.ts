export const UNIT_TYPES = ['BAN', 'PHONG'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** Đơn vị trong cơ cấu Ban Tổ chức Tỉnh ủy: Ban hoặc phòng (SPEC-001 mục 7). */
export interface UnitModel {
  id: string;
  code: string;
  name: string;
  type: UnitType;
  parentId: string | null;
}

export type NewUnit = Omit<UnitModel, 'id'>;
export type UnitPatch = Partial<Pick<UnitModel, 'name' | 'type' | 'parentId'>>;
