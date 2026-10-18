import type { EvaluationStatus, OrgUnit, RatingCode } from './api';

/** Lý do hủy kết quả đã phê duyệt (ADR-059). */
export const REVOCATION_LABELS: Record<'KHONG_DU_DIEU_KIEN' | 'SAI_SO_LIEU' | 'KY_LUAT_SAU' | 'KHAC', string> = {
  KHONG_DU_DIEU_KIEN: 'Phát hiện không bảo đảm điều kiện, tiêu chuẩn của mức xếp loại',
  SAI_SO_LIEU: 'Sai số liệu hoặc sai sót trong chấm điểm',
  KY_LUAT_SAU: 'Kỷ luật hoặc kết luận phát sinh sau, liên quan đến kỳ đã xếp loại',
  KHAC: 'Lý do khác',
};

/** Loại nhóm tính hạn mức xuất sắc (ADR-060). */
export const QUOTA_KIND_LABELS = { LEADER: 'Lãnh đạo, quản lý', STAFF: 'Công chức, chuyên viên', SUPPORT: 'Người lao động hỗ trợ, phục vụ' } as const;

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
  DAI_DIEN_THUONG_VU: 'Đại diện Ban Thường vụ',
};

export const DURATION_LABELS = { LIMITED: 'Có hạn mức', ACTUAL: 'Thực tế', UNSPECIFIED: 'Không nêu' } as const;
export const UNIT_LABELS = { HOUR: 'giờ', DAY: 'ngày' } as const;

export const REPORT_KIND_LABELS = { MONTH: 'Báo cáo tháng', QUARTER: 'Báo cáo quý', YEAR: 'Báo cáo năm' } as const;
export const STATE_LABELS = {
  PROPOSED: 'Chờ duyệt đề xuất',
  IN_PROGRESS: 'Đang làm',
  PENDING_CONFIRM: 'Chờ xác nhận',
  OVERDUE: 'Quá hạn',
  DONE: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
} as const;
export const STATE_COLORS = { PROPOSED: 'purple', IN_PROGRESS: 'blue', PENDING_CONFIRM: 'gold', OVERDUE: 'red', DONE: 'green', CANCELLED: 'default' } as const;

/** Giờ Việt Nam, dạng "14:05 03/10/2026", từ chuỗi ISO. */
export const dateTimeText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–';

export const fileSizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export const PROGRESS_LABELS = { REPORTED: 'Chờ xác nhận', CONFIRMED: 'Đã xác nhận', REJECTED: 'Bị từ chối' } as const;

export const dateText = (iso: string | null) => (iso ? iso.slice(0, 10) : '–');

export const num = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(2).replace('.', ','));

/** Tên và chức vụ theo mã cán bộ, dựng từ sơ đồ tổ chức. */
export function peopleIndex(tree: OrgUnit[]): Map<string, { fullName: string; positionTitle: string; unitName: string }> {
  const index = new Map<string, { fullName: string; positionTitle: string; unitName: string; kind: string }>();
  for (const unit of tree) {
    for (const p of unit.positions) {
      // Cán bộ kiêm nhiệm giữ nhiều vị trí: tên và chức vụ hiển thị theo vị trí chính.
      if (p.holder && (!index.has(p.holder.personId) || p.holder.kind === 'PRIMARY')) {
        index.set(p.holder.personId, { fullName: p.holder.fullName, positionTitle: p.title, unitName: unit.name, kind: p.holder.kind });
      }
    }
  }
  return index;
}

/** Tên chức danh và đơn vị theo mã vị trí (dùng cho phiếu đánh giá và việc, vốn gắn với một vị trí cụ thể; ADR-047). */
export function positionIndex(tree: OrgUnit[]): Map<string, { title: string; unitName: string }> {
  return new Map(tree.flatMap((u) => u.positions.map((p) => [p.id, { title: p.title, unitName: u.name }] as const)));
}

export const WORK_KIND_LABELS = { CATALOG: 'Giao từ danh mục', AD_HOC: 'Đột xuất', RECURRING: 'Định kỳ' } as const;

export const ASSIGNMENT_KIND_LABELS = { PRIMARY: 'Vị trí chính', CONCURRENT: 'Kiêm nhiệm' } as const;

/** Nhãn mô-đun và loại thao tác của nhật ký (PLAN-A A5). */
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  security: 'Bảo mật',
  organization: 'Tổ chức',
  catalog: 'Danh mục',
  tasking: 'Giao việc',
  project: 'Đề án, dự án',
  meeting: 'Lịch họp',
  evaluation: 'Đánh giá',
  reporting: 'Báo cáo',
  documents: 'Tài liệu',
  notifications: 'Thông báo',
  system: 'Hệ thống',
};

export const AUDIT_TYPE_LABELS: Record<string, string> = {
  CREATE: 'Tạo mới',
  UPDATE: 'Sửa',
  DELETE: 'Xóa',
  STATUS_CHANGE: 'Đổi trạng thái',
  APPROVE: 'Luồng duyệt',
  LOGIN: 'Đăng nhập',
  EXPORT: 'Xuất tệp',
  ACCESS: 'Xem, tải',
  REVIEW: 'Rà soát quyền',
  OTHER: 'Khác',
};

/** Việc đột xuất (ADR-046): bốn mức độ khó và hệ số quy đổi (khớp `AD_HOC_COEFFICIENTS` của máy chủ). */
export const AD_HOC_LEVEL_OPTIONS = [
  { value: 1, label: 'Mức 1 – Đơn giản (hệ số 0,5)' },
  { value: 2, label: 'Mức 2 – Trung bình (hệ số 1)' },
  { value: 3, label: 'Mức 3 – Khó (hệ số 2)' },
  { value: 4, label: 'Mức 4 – Rất khó (hệ số 3)' },
];

/** Tên nhiệm vụ tự tạo chứa các việc đột xuất của một cán bộ (khớp máy chủ). */
export const AD_HOC_TASK_TITLE = 'Việc đột xuất';

export const FREQUENCY_LABELS = { WEEKLY: 'Hằng tuần (thứ Hai)', MONTHLY: 'Hằng tháng (ngày 1)', QUARTERLY: 'Hằng quý (đầu quý)', YEARLY: 'Hằng năm (1/1)' } as const;

/** Bỏ dấu và viết thường để tìm "thu nghiem" ra "Thử Nghiệm". */
export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();

/** Đề án, dự án (ADR-050): khớp `STATUS_TEXT` và `KIND_TEXT` của máy chủ. */
export const PROJECT_STATUS_LABELS = { DRAFT: 'Đang soạn', SUBMITTED: 'Chờ duyệt', ACTIVE: 'Đang thực hiện', COMPLETED: 'Đã nghiệm thu', CANCELLED: 'Đã hủy' } as const;
export const PROJECT_STATUS_COLORS = { DRAFT: 'default', SUBMITTED: 'gold', ACTIVE: 'blue', COMPLETED: 'green', CANCELLED: 'red' } as const;
export const PROJECT_KIND_LABELS = { DE_AN: 'Đề án', DU_AN: 'Dự án' } as const;

/** Tỷ lệ 0–1 thành phần trăm, dấu phẩy thập phân. */
export const percentText = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1).replace('.', ',')}%`);

/** Ngày YYYY-MM-DD thành DD/MM/YYYY. */
export const dmyText = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '–');

/** Lịch họp (ADR-051). */
export const MEETING_STATUS_LABELS = { SCHEDULED: 'Sắp họp', HELD: 'Đã họp', CANCELLED: 'Đã hủy' } as const;
export const MEETING_STATUS_COLORS = { SCHEDULED: 'blue', HELD: 'green', CANCELLED: 'default' } as const;
export const MEETING_RESPONSE_LABELS = { PENDING: 'Chờ trả lời', ACCEPTED: 'Tham dự', DECLINED: 'Từ chối' } as const;
export const MEETING_RESPONSE_COLORS = { PENDING: 'gold', ACCEPTED: 'green', DECLINED: 'red' } as const;
export const MEETING_ROLE_LABELS = { ORGANIZER: 'Chủ trì', REQUIRED: 'Bắt buộc', OPTIONAL: 'Không bắt buộc' } as const;

const VN_OFFSET_MS = 7 * 3600_000;

/** Chuỗi "đồng hồ treo tường" giờ Việt Nam (YYYY-MM-DDTHH:mm:ss, không múi giờ) từ một thời điểm ISO. */
export const vnWall = (iso: string | number | Date) => new Date(new Date(iso).getTime() + VN_OFFSET_MS).toISOString().slice(0, 19);

/** Giờ Việt Nam "HH:mm" từ chuỗi ISO. */
export const hhmmText = (iso: string) => vnWall(iso).slice(11, 16);

/** Giờ Việt Nam "HH:mm dd/MM/yyyy". */
export const meetingTimeText = (iso: string) => {
  const w = vnWall(iso);
  return `${w.slice(11, 16)} ${w.slice(8, 10)}/${w.slice(5, 7)}/${w.slice(0, 4)}`;
};

/** Khoảng giờ họp: "08:30–10:00 20/10/2026" (khác ngày thì ghi đủ hai đầu). */
export const meetingRangeText = (startIso: string, endIso: string) => {
  const s = vnWall(startIso);
  const e = vnWall(endIso);
  return s.slice(0, 10) === e.slice(0, 10) ? `${s.slice(11, 16)}–${e.slice(11, 16)} ${meetingTimeText(startIso).slice(6)}` : `${meetingTimeText(startIso)} – ${meetingTimeText(endIso)}`;
};

/** Chuỗi ISO có múi giờ +07:00 từ "đồng hồ treo tường" giờ Việt Nam (YYYY-MM-DDTHH:mm:ss). */
export const vnIso = (wall: string) => `${wall.slice(0, 19)}+07:00`;

/** Ngoại lệ văn bản cho phép giữ mức theo điểm khi có điều kiện "Không hoàn thành nhiệm vụ" (ADR-055). */
export const EXCEPTION_LABELS: Record<string, string> = {
  TU_GIAC_KHAC_PHUC: 'Tự giác nhận lỗi, tự phát hiện vi phạm và đã khắc phục xong hậu quả',
  DA_TINH_NAM_TRUOC: 'Vi phạm đã tính ở năm trước (hoặc kỷ luật đảng, hành chính cùng hành vi ở hai năm)',
  VI_PHAM_DON_VI_CU: 'Vi phạm xảy ra ở cơ quan, đơn vị cũ',
  BAT_KHA_KHANG: 'Không hoàn thành nhiệm vụ, chỉ tiêu do bất khả kháng',
  KHONG_THE_BIET: 'Không thể biết, hoặc đã áp dụng biện pháp phòng ngừa tham nhũng, tiêu cực',
};
