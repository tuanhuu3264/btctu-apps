/** Loại sự kiện phát sinh thông báo (ADR-029 mục 3). */
export type NotificationType =
  | 'TASK_ASSIGNED'
  | 'TASK_ROLE'
  | 'TASK_REPORTED'
  | 'TASK_CONFIRMED'
  | 'TASK_REJECTED'
  | 'TASK_CANCELLED'
  | 'TASK_COMMENT'
  | 'EVAL_SELF_SUBMITTED'
  | 'EVAL_REVIEWED'
  | 'EVAL_APPROVED'
  | 'EVAL_RETURNED'
  | 'DEADLINE_REMINDER'
  | 'COMPLAINT_RECEIVED'
  | 'DOC_PUBLISHED'
  | 'TASK_PROPOSED'
  | 'TASK_PROPOSAL_DECIDED'
  | 'ACCESS_REVIEW_ASSIGNED'
  | 'ACCESS_REVIEW_REMINDER'
  | 'ACCESS_REVIEW_OVERDUE';

export interface NotificationContent {
  type: NotificationType;
  /** Ngắn gọn, không chứa điểm, xếp loại hay nhận xét (ADR-029 mục 4). */
  title: string;
  /** Đường dẫn nội bộ của giao diện, ví dụ `/tasks?open=<id>`. */
  link?: string;
}

/**
 * Cổng gửi thông báo cho các mô-đun nghiệp vụ (ADR-029). Gửi không bao giờ làm thao tác chính thất bại:
 * lỗi được nuốt và ghi nhật ký lỗi ở bên cài đặt. Người nhận trống hoặc trùng được bỏ qua.
 */
export abstract class Notifier {
  /** Gửi cho các cán bộ nêu ra. */
  abstract notify(personIds: readonly (string | null | undefined)[], content: NotificationContent): Promise<void>;
  /** Gửi cho mọi cán bộ có tài khoản đang hoạt động và có quyền `permission`, trừ `exceptPersonId`. */
  abstract notifyPermitted(permission: string, exceptPersonId: string | null | undefined, content: NotificationContent): Promise<void>;
}
