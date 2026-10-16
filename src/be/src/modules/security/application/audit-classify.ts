/** Phân loại bản ghi nhật ký theo mô-đun và loại thao tác (PLAN-A A5, ADR-045). */
export const AUDIT_MODULES = [
  'security',
  'organization',
  'catalog',
  'tasking',
  'evaluation',
  'reporting',
  'documents',
  'notifications',
  'system',
] as const;
export type AuditModule = (typeof AUDIT_MODULES)[number];

/**
 * CREATE tạo mới; UPDATE sửa nội dung; DELETE xóa dòng; STATUS_CHANGE đổi trạng thái (ngừng, kích hoạt, đóng, hủy, thu hồi);
 * APPROVE các bước của luồng duyệt (tự chấm, thẩm định, trả lại, phê duyệt, xác nhận, từ chối); LOGIN đăng nhập, đăng xuất, khóa;
 * EXPORT xuất tệp; ACCESS xem, tải, bị từ chối quyền; REVIEW rà soát quyền định kỳ; OTHER còn lại.
 */
export const AUDIT_TYPES = ['CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'APPROVE', 'LOGIN', 'EXPORT', 'ACCESS', 'REVIEW', 'OTHER'] as const;
export type AuditType = (typeof AUDIT_TYPES)[number];

const MODULE_BY_PREFIX: Record<string, AuditModule> = {
  access: 'security',
  'access-review': 'security',
  account: 'security',
  auth: 'security',
  audit: 'security',
  role: 'security',
  unit: 'organization',
  position: 'organization',
  person: 'organization',
  assignment: 'organization',
  org: 'organization',
  catalog: 'catalog',
  tasking: 'tasking',
  evaluation: 'evaluation',
  'unit-evaluation': 'evaluation',
  'unit-complaint': 'evaluation',
  report: 'reporting',
  document: 'documents',
  notification: 'notifications',
};

/** Quy tắc theo thứ tự: quy tắc đầu tiên khớp thì dùng. Khớp với toàn bộ chuỗi hành động. */
const TYPE_RULES: [RegExp, AuditType][] = [
  [/^access-review\.export$/, 'EXPORT'],
  [/^access-review\./, 'REVIEW'],
  [/^unit-complaint\.(verify|close)$/, 'APPROVE'],
  [/^auth\.(login|logout|account\.locked)/, 'LOGIN'],
  [/^access\.denied$/, 'ACCESS'],
  [/export/, 'EXPORT'],
  [/(^|\.)(read|view|list|download|trend|draft|verify)$/, 'ACCESS'],
  [/^report\.(draft|trend|view|unit\.view)/, 'ACCESS'],
  [/(^|\.)(approve|confirm|reject|review|return|self-submit|not-rated)$/, 'APPROVE'],
  [/(^|\.)(deactivate|reactivate|disable|close|cancel|revoke|end|withdraw)$/, 'STATUS_CHANGE'],
  [/^evaluation\.period\.close$/, 'STATUS_CHANGE'],
  [/(^|\.)(delete|remove)$/, 'DELETE'],
  [/(^|\.)(create|generate|grant|upload|import|publish|apply)$/, 'CREATE'],
  [/^evaluation\.task\.assign$/, 'CREATE'],
  [/^org\.import$/, 'CREATE'],
  [/(^|\.)(update|rename|scope|set|replace|deadline|result|link-person|unlink-person|leave\.update|axes\.update)$/, 'UPDATE'],
  [/^catalog\.baseline\.set$/, 'UPDATE'],
  [/^tasking\.progress\.report$/, 'CREATE'],
];

/** Suy mô-đun và loại từ chuỗi hành động. Nơi gọi có thể nêu rõ để thay thế (xem `AuditEntryInput`). */
export function classifyAction(action: string): { module: AuditModule; type: AuditType } {
  const prefix = action.includes('.') ? action.slice(0, action.indexOf('.')) : action;
  const module = MODULE_BY_PREFIX[prefix] ?? 'system';
  const type = TYPE_RULES.find(([re]) => re.test(action))?.[1] ?? 'OTHER';
  return { module, type };
}
