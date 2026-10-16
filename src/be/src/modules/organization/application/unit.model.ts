export const UNIT_TYPES = ['BAN', 'PHONG'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** Trạng thái dùng chung cho đơn vị và vị trí: "xóa" chỉ là chuyển sang INACTIVE, dữ liệu lịch sử vẫn giữ (PLAN-A A1). */
export const ORG_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

/** Dấu vết ngừng sử dụng, chung cho đơn vị và vị trí. */
export interface InactiveInfo {
  status: OrgStatus;
  inactiveAt: Date | null;
  inactiveReason: string | null;
}

/** Đơn vị trong cơ cấu Ban Tổ chức Tỉnh ủy: Ban hoặc phòng (SPEC-001 mục 7). */
export interface UnitModel extends InactiveInfo {
  id: string;
  code: string;
  name: string;
  type: UnitType;
  parentId: string | null;
}

export type NewUnit = Omit<UnitModel, 'id' | keyof InactiveInfo>;
export type UnitPatch = Partial<Pick<UnitModel, 'name' | 'type' | 'parentId'>>;
