import type { Permission, Role } from './authorization.model.js';

/** Mọi cán bộ: xem hồ sơ của mình và tự chấm. */
const STAFF: readonly Permission[] = ['evaluation:read', 'evaluation:self', 'report:read', 'task:read', 'task:report', 'document:read'];
/** Cán bộ quản lý: ngoài việc của mình còn giao việc, thẩm định, phê duyệt cho cấp dưới (phạm vi do cây vị trí quyết định). */
const MANAGER: readonly Permission[] = [...STAFF, 'evaluation:assign', 'evaluation:review', 'evaluation:approve', 'report:export', 'task:assign', 'task:confirm', 'access-review:confirm', 'project:create'];

/**
 * Ma trận vai trò → quyền. Là giả định của nhóm phát triển, chưa có căn cứ trong tài liệu
 * (GAP G-13). Đổi bằng cách sửa file này, có kiểm thử bất biến kèm theo.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // Phê duyệt danh mục sản phẩm công việc chuẩn thuộc cấp có thẩm quyền (05-HD/TU mục IV.4); giả định là Trưởng ban (G-13).
  // Các quyền evaluation:* là điều kiện cần; phạm vi theo cây vị trí (ai là cấp trên của ai) còn được kiểm tra
  // ở lớp nghiệp vụ (ADR-014 mục 4). Quản trị hệ thống và quản trị dữ liệu không có quyền nào về đánh giá.
  TRUONG_BAN: ['org:read', 'catalog:read', 'catalog:approve', ...MANAGER, 'evaluation:read-all', 'report:draft', 'task:read-all', 'document:manage', 'project:read-all', 'project:approve', 'meeting:read-all'],
  PHO_TRUONG_BAN: ['org:read', 'catalog:read', ...MANAGER, 'project:read-all'],
  TRUONG_PHO_PHONG: ['org:read', 'catalog:read', ...MANAGER],
  CHUYEN_VIEN: ['org:read', 'catalog:read', ...STAFF],
  // Văn phòng giữ dữ liệu cơ cấu tổ chức (đơn vị, cán bộ, vị trí, phân công).
  // Soạn danh mục: cơ quan tham mưu tổ chức cán bộ tổng hợp trình phê duyệt (05-HD/TU); giả định giao cho Văn phòng (G-13).
  VAN_PHONG: ['org:read', 'org:manage', 'catalog:read', 'catalog:manage', ...STAFF, 'evaluation:read-all', 'evaluation:period-manage', 'complaint:manage', 'report:export', 'report:draft', 'task:read-all', 'document:manage', 'project:read-all', 'meeting:read-all', 'meeting:manage-rooms'],
  // Quản trị hệ thống tạo, đóng đợt rà soát quyền và xuất kết quả; không tự xác nhận (ADR-044).
  QUAN_TRI_HE_THONG: ['org:read', 'catalog:read', 'account:create', 'account:read', 'account:disable', 'account:mfa-reset', 'role:assign', 'role:read', 'access-review:manage'],
  // Quản trị dữ liệu quyết định ai khai thác dữ liệu nào (QĐ 342 Điều 16.4) nên gắn tài khoản với cán bộ,
  // vì phạm vi dữ liệu suy ra từ vị trí của cán bộ đó. Đồng thời giám sát: đọc tài khoản, vai trò, nhật ký.
  // Quản trị hệ thống không đọc nhật ký để không tự kiểm tra chính mình (GAP G-13).
  // Ban Thường vụ nằm ngoài cơ cấu của Ban nên thẩm định, phê duyệt hồ sơ tập thể của Ban bằng tài khoản có quyền riêng (ADR-030).
  DAI_DIEN_THUONG_VU: ['org:read', 'catalog:read', 'evaluation:read', 'evaluation:review', 'evaluation:approve', 'evaluation:decide-ban'],
  // Quản trị dữ liệu giám sát rà soát quyền: xem mọi đợt và xác nhận các mục không có lãnh đạo phụ trách (ADR-044).
  QUAN_TRI_DU_LIEU: ['org:read', 'catalog:read', 'account:read', 'account:link-person', 'role:read', 'audit:read', 'access-review:oversee'],
};

/**
 * Vai trò quản trị phải tách biệt: không đi kèm vai trò nào khác, kể cả vai trò quản trị còn lại
 * (QĐ 342 Điều 16 tách chủ quản dữ liệu, quản trị dữ liệu, quản trị hệ thống; ADR-004 mục 2).
 * Đại diện Ban Thường vụ cũng tách riêng: người của Ban không được vừa tự đánh giá vừa thẩm định hồ sơ của Ban (ADR-030).
 */
export const EXCLUSIVE_ROLES: readonly Role[] = ['QUAN_TRI_HE_THONG', 'QUAN_TRI_DU_LIEU', 'DAI_DIEN_THUONG_VU'];
