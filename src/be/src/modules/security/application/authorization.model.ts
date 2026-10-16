/** 7 vai trò theo SPEC-001 mục 3, thêm đại diện Ban Thường vụ để thẩm định, phê duyệt hồ sơ tập thể của Ban (ADR-030). */
export const ROLES = [
  'TRUONG_BAN',
  'PHO_TRUONG_BAN',
  'TRUONG_PHO_PHONG',
  'CHUYEN_VIEN',
  'VAN_PHONG',
  'QUAN_TRI_HE_THONG',
  'QUAN_TRI_DU_LIEU',
  'DAI_DIEN_THUONG_VU',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Quyền dạng `tài-nguyên:hành-động`. Chỉ khai báo quyền của tài nguyên đã có endpoint;
 * quyền của catalog, evaluation, reporting thêm khi các mô-đun đó được làm.
 */
export const PERMISSIONS = [
  'org:read',
  'org:manage',
  'account:create',
  'account:read',
  'account:disable',
  'account:link-person',
  'role:assign',
  'role:read',
  'audit:read',
  'access-review:manage',
  'access-review:confirm',
  'access-review:oversee',
  'catalog:read',
  'catalog:manage',
  'catalog:approve',
  'evaluation:read',
  'evaluation:read-all',
  'evaluation:period-manage',
  'evaluation:assign',
  'evaluation:self',
  'evaluation:review',
  'evaluation:approve',
  'evaluation:decide-ban',
  'complaint:manage',
  'task:read',
  'task:read-all',
  'task:assign',
  'task:report',
  'task:confirm',
  'report:read',
  'report:export',
  'report:draft',
  'document:read',
  'document:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface RoleAssignmentModel {
  id: string;
  accountId: string;
  role: Role;
  validFrom: Date;
  /** null: không hết hạn. */
  validTo: Date | null;
  /** null: cấp bằng lệnh khởi tạo (bootstrap). */
  grantedBy: string | null;
  revokedAt: Date | null;
}

export type NewRoleAssignment = Pick<RoleAssignmentModel, 'accountId' | 'role' | 'validFrom' | 'validTo' | 'grantedBy'>;

export interface AccountSummary {
  id: string;
  username: string;
  status: 'ACTIVE' | 'DISABLED';
  personId: string | null;
  lockedUntil: Date | null;
}

/** Đang có hiệu lực tại thời điểm `at`. */
export function isEffective(a: RoleAssignmentModel, at: Date): boolean {
  return !a.revokedAt && a.validFrom <= at && (a.validTo === null || a.validTo > at);
}

/** Đang hiệu lực hoặc sẽ có hiệu lực (chưa thu hồi, chưa hết hạn). */
export function isLive(a: RoleAssignmentModel, at: Date): boolean {
  return !a.revokedAt && (a.validTo === null || a.validTo > at);
}
