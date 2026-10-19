/** Loại đơn thư, phản ánh về tập thể (Nghị định 335 Điều 9.2.a). */
export type ComplaintKind = 'KHIEU_NAI' | 'TO_CAO' | 'PHAN_ANH' | 'MAT_DOAN_KET';
/** RECEIVED: mới ghi nhận. VERIFYING: người có thẩm quyền đã chỉ đạo kiểm tra, xác minh. CLOSED: đã có kết luận. */
export type ComplaintStatus = 'RECEIVED' | 'VERIFYING' | 'CLOSED';
/** SUBSTANTIATED: xác minh đúng. UNFOUNDED: xác minh không đúng. */
export type ComplaintOutcome = 'SUBSTANTIATED' | 'UNFOUNDED';

export const COMPLAINT_KINDS: readonly ComplaintKind[] = ['KHIEU_NAI', 'TO_CAO', 'PHAN_ANH', 'MAT_DOAN_KET'];
export const COMPLAINT_OUTCOMES: readonly ComplaintOutcome[] = ['SUBSTANTIATED', 'UNFOUNDED'];

export const COMPLAINT_KIND_LABELS: Record<ComplaintKind, string> = {
  KHIEU_NAI: 'Khiếu nại',
  TO_CAO: 'Tố cáo',
  PHAN_ANH: 'Phản ánh tiêu cực',
  MAT_DOAN_KET: 'Dấu hiệu mất đoàn kết nội bộ',
};

/** Khiếu nại, phản ánh về một tập thể trong một kỳ năm (ADR-038). Còn mở thì chặn công nhận xếp loại tập thể. */
export interface UnitComplaintModel {
  id: string;
  unitId: string;
  periodId: string;
  kind: ComplaintKind;
  content: string;
  source: string | null;
  /** Ngày nhận, YYYY-MM-DD. */
  receivedOn: string;
  status: ComplaintStatus;
  createdBy: string | null;
  createdAt: Date;
  /** Người hoặc đơn vị được giao kiểm tra, xác minh, và hạn nếu có. */
  assignee: string | null;
  verifyDue: string | null;
  verifyDirectedBy: string | null;
  verifyDirectedAt: Date | null;
  outcome: ComplaintOutcome | null;
  conclusion: string | null;
  closedBy: string | null;
  closedAt: Date | null;
}

export type NewUnitComplaint = Pick<UnitComplaintModel, 'unitId' | 'periodId' | 'kind' | 'content' | 'source' | 'receivedOn' | 'createdBy'>;
export type UnitComplaintPatch = Partial<
  Pick<UnitComplaintModel, 'status' | 'assignee' | 'verifyDue' | 'verifyDirectedBy' | 'verifyDirectedAt' | 'outcome' | 'conclusion' | 'closedBy' | 'closedAt'>
>;

export abstract class UnitComplaintRepository {
  abstract create(data: NewUnitComplaint): Promise<UnitComplaintModel>;
  abstract findById(id: string): Promise<UnitComplaintModel | null>;
  abstract findByUnitAndPeriod(unitId: string, periodId: string): Promise<UnitComplaintModel[]>;
  /** Số khiếu nại chưa đóng của từng đơn vị trong kỳ, theo mã đơn vị. */
  abstract openCounts(periodId: string): Promise<Map<string, number>>;
  abstract update(id: string, patch: UnitComplaintPatch): Promise<UnitComplaintModel>;
  /**
   * Số phản ánh, khiếu nại về mâu thuẫn, mất đoàn kết nội bộ của đơn vị nhận trong khoảng ngày (gồm hai đầu), không tính
   * những phản ánh đã xác minh là không đúng (Nghị định 335 Điều 15.3.c, ADR-040).
   */
  abstract countSolidarityIssues(unitId: string, from: string, to: string): Promise<number>;
}

/** Khiếu nại còn mở: chưa có kết luận. */
export const isOpen = (c: Pick<UnitComplaintModel, 'status'>): boolean => c.status !== 'CLOSED';

/** Câu cảnh báo trên hồ sơ khi còn khiếu nại mở; dấu hiệu cố định để lọc khỏi bản người đứng đầu xem. */
export const COMPLAINT_WARNING_MARK = 'Điều 9.2.a';
export const complaintWarning = (open: number): string =>
  `Còn ${open} khiếu nại, phản ánh chưa kiểm tra, xác minh xong: chưa công nhận được xếp loại tập thể (Nghị định 335 Điều 9.2.a).`;
