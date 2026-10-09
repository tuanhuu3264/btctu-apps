import type { EvaluationStatus, OrgUnit, RatingCode } from './api';

export const RATING_LABELS: Record<RatingCode, string> = {
  XUAT_SAC: 'Hoàn thành xuất sắc nhiệm vụ',
  HOAN_THANH_TOT: 'Hoàn thành tốt nhiệm vụ',
  HOAN_THANH: 'Hoàn thành nhiệm vụ',
  KHONG_HOAN_THANH: 'Không hoàn thành nhiệm vụ',
};

export const STATUS_LABELS: Record<EvaluationStatus, string> = {
  PLANNED: 'Đang thực hiện',
  SELF_SUBMITTED: 'Đã tự chấm, chờ thẩm định',
  REVIEWED: 'Đã thẩm định, chờ phê duyệt',
  APPROVED: 'Đã phê duyệt',
};

export const QUALITY_LABELS: Record<number, string> = {
  1: '1 – Chủ động, hiệu quả',
  2: '2 – Cơ bản đáp ứng',
  3: '3 – Không đáp ứng (không được tính)',
};

export const ROLE_LABELS: Record<string, string> = {
  TRUONG_BAN: 'Trưởng ban',
  PHO_TRUONG_BAN: 'Phó Trưởng ban',
  TRUONG_PHO_PHONG: 'Trưởng, Phó phòng',
  CHUYEN_VIEN: 'Chuyên viên',
  VAN_PHONG: 'Văn phòng',
  QUAN_TRI_HE_THONG: 'Quản trị hệ thống',
  QUAN_TRI_DU_LIEU: 'Quản trị dữ liệu',
};

export const DURATION_LABELS = { LIMITED: 'Có hạn mức', ACTUAL: 'Thực tế', UNSPECIFIED: 'Không nêu' } as const;
export const UNIT_LABELS = { HOUR: 'giờ', DAY: 'ngày' } as const;

export const REPORT_KIND_LABELS = { MONTH: 'Báo cáo tháng', QUARTER: 'Báo cáo quý', YEAR: 'Báo cáo năm' } as const;
export const STATE_LABELS = {
  IN_PROGRESS: 'Đang làm',
  PENDING_CONFIRM: 'Chờ xác nhận',
  OVERDUE: 'Quá hạn',
  DONE: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
} as const;
export const STATE_COLORS = { IN_PROGRESS: 'blue', PENDING_CONFIRM: 'gold', OVERDUE: 'red', DONE: 'green', CANCELLED: 'default' } as const;

/** Giờ Việt Nam, dạng "14:05 03/10/2026", từ chuỗi ISO. */
export const dateTimeText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';

export const fileSizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export const PROGRESS_LABELS = { REPORTED: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', REJECTED: 'Bị từ chối' } as const;

export const dateText = (iso: string | null) => (iso ? iso.slice(0, 10) : '–');

export const num = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(2).replace('.', ','));

/** Tên và chức vụ theo mã cán bộ, dựng từ sơ đồ tổ chức. */
export function peopleIndex(tree: OrgUnit[]): Map<string, { fullName: string; positionTitle: string; unitName: string }> {
  const index = new Map<string, { fullName: string; positionTitle: string; unitName: string }>();
  for (const unit of tree) {
    for (const p of unit.positions) {
      if (p.holder) index.set(p.holder.personId, { fullName: p.holder.fullName, positionTitle: p.title, unitName: unit.name });
    }
  }
  return index;
}
