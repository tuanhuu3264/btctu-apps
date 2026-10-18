import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000/api';

export class UnauthorizedError extends Error {
  constructor() {
    super('Chưa đăng nhập hoặc phiên đã hết hạn');
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super('Tài khoản chưa được cấp quyền thực hiện thao tác này');
  }
}

export interface Me {
  id: string;
  username: string;
  personId: string | null;
  roles: string[];
  permissions: string[];
}

export interface OrgPosition {
  id: string;
  code: string;
  title: string;
  level: number;
  /** Giữ vị trí này là cán bộ lãnh đạo, quản lý (ADR-022). */
  isLeader: boolean;
  /** Vị trí của người lao động hỗ trợ, phục vụ (ADR-053). */
  isSupport: boolean;
  reportsToPositionId: string | null;
  /** Xóa mềm (PLAN-A A1): vị trí ngừng sử dụng chỉ có khi lấy kèm `includeInactive`. */
  status: 'ACTIVE' | 'INACTIVE';
  inactiveReason: string | null;
  /** `kind`: giữ vị trí này là vị trí chính hay kiêm nhiệm (ADR-047). */
  holder: { personId: string; fullName: string; kind: AssignmentKind } | null;
}

export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  type: 'BAN' | 'PHONG';
  parentId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  inactiveReason: string | null;
  positions: OrgPosition[];
}

/** Gọi backend từ phía máy chủ Next, chuyển cookie phiên của người dùng sang backend. */
async function serverFetch<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', headers: { cookie: cookieHeader } });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 403) throw new ForbiddenError();
  if (!res.ok) throw new Error(`Gọi ${path} thất bại (HTTP ${res.status})`);
  return res.json();
}

export const fetchMe = () => serverFetch<Me>('/auth/me');
export const fetchAssignment = (id: string) => serverFetch<AssignmentView>(`/tasking/assignments/${id}`);
export const fetchDocCategories = () => serverFetch<DocCategory[]>('/documents/categories');

/** Danh mục tài liệu (ADR-025). */
export interface DocCategory {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  /** Số bài đang đăng. */
  postCount: number;
}

export interface DocPostFile {
  id: string;
  postId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface DocPost {
  id: string;
  categoryId: string;
  categoryName: string;
  title: string;
  summary: string;
  status: 'PUBLISHED' | 'WITHDRAWN';
  publishedAt: string;
  updatedAt: string;
  publishedByPersonId: string | null;
  files: DocPostFile[];
}

export interface DocPostPage {
  items: DocPost[];
  total: number;
  page: number;
  pageSize: number;
}

/** Một tệp trong màn "Tài liệu trong công việc". */
export interface TaskFile {
  id: string;
  assignmentId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByPersonId: string | null;
  taskTitle: string;
  catalogItemCode: string;
  assigneePersonId: string;
}

export interface TaskFilePage {
  items: TaskFile[];
  total: number;
  page: number;
  pageSize: number;
}
/** `includeInactive`: lấy cả đơn vị và vị trí đã ngừng sử dụng (trang quản lý). Mặc định chỉ lấy đang hoạt động. */
export const fetchOrgTree = (includeInactive = false) => serverFetch<OrgUnit[]>(`/org/tree${includeInactive ? '?includeInactive=true' : ''}`);

/** Hạn hoàn thành đánh giá năm (ADR-038). */
export interface Deadline {
  date: string;
  extended: boolean;
  daysLeft: number;
  overdue: boolean;
  reminder: boolean;
}

export interface Period {
  id: string;
  /** Phiên bản danh mục đã phê duyệt dùng cho kỳ này. */
  catalogVersionId?: string;
  type: string;
  year?: number;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  /** Chỉ kỳ năm có hạn. */
  deadline?: Deadline | null;
}

export interface Stats {
  /** Số hồ sơ (phiếu); cán bộ kiêm nhiệm có một phiếu cho mỗi vị trí. */
  evaluations: number;
  /** Số cán bộ khác nhau có hồ sơ (loại trùng người kiêm nhiệm). */
  people: number;
  approved: number;
  pendingApproval: number;
  inProgress: number;
  completionRate: number | null;
  averageTotal: number | null;
  minTotal: number | null;
  maxTotal: number | null;
  ratings: Record<'XUAT_SAC' | 'HOAN_THANH_TOT' | 'HOAN_THANH' | 'KHONG_HOAN_THANH', number>;
  excellentQuota: { excellent: number; good: number; allowed: number; exceeded: boolean };
}

export interface ReportRow {
  evaluationId: string;
  personId: string;
  fullName: string;
  positionTitle: string;
  unitName: string;
  status: 'PLANNED' | 'SELF_SUBMITTED' | 'REVIEWED' | 'APPROVED';
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: 'XUAT_SAC' | 'HOAN_THANH_TOT' | 'HOAN_THANH' | 'KHONG_HOAN_THANH' | null;
}

export interface PeriodReport {
  period: Period;
  scope: 'ALL' | 'LIMITED';
  generatedAt: string;
  overall: Stats;
  byUnit: (Stats & { unitCode: string; unitName: string })[];
  rows: ReportRow[];
  notes: string[];
}

export interface TrendPoint {
  period: Period;
  evaluations: number;
  approved: number;
  completionRate: number | null;
  averageTotal: number | null;
  ratings: Stats['ratings'];
}

export interface Trend {
  type: string;
  scope: 'ALL' | 'LIMITED';
  points: TrendPoint[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}

export interface Draft {
  kind: 'REPORT' | 'DECISION' | 'NOTICE';
  title: string;
  body: string;
  disclaimer: string;
  approvedCount: number;
}

export type EvaluationStatus = 'PLANNED' | 'SELF_SUBMITTED' | 'REVIEWED' | 'APPROVED';
export type RatingCode = 'XUAT_SAC' | 'HOAN_THANH_TOT' | 'HOAN_THANH' | 'KHONG_HOAN_THANH';

export interface EvaluationSummary {
  id: string;
  periodId: string;
  personId: string;
  /** Vị trí của phiếu: cán bộ kiêm nhiệm có một phiếu riêng cho mỗi vị trí (ADR-047). */
  positionId: string;
  status: EvaluationStatus;
  totalScore: number | null;
  rating: RatingCode | null;
}

export interface EvaluationTask {
  id: string;
  catalogItemCode: string;
  name: string;
  coefficient: number | null;
  plannedQuantity: number;
  completedQuantity: number;
  qualityLevel: number | null;
  evidence: string | null;
  /** Các việc được giao đã gộp thành dòng này; rỗng nếu là dòng nhập tay. */
  sourceAssignmentIds: string[];
  /** Tên các nhiệm vụ chứa những việc nguồn. */
  sourceTaskTitles: string[];
  lateCount: number;
  reworkCount: number;
  /** Số lần đã được miễn trừ do nguyên nhân khách quan; không nằm trong hai số trên. */
  waivedLateCount: number;
  waivedReworkCount: number;
}

/** Ba tiêu chí lãnh đạo, chỉ đạo (D): mỗi tiêu chí là 1 (đạt 100%) hoặc 0,5 (đạt 50%). */
export interface Leadership {
  unitResult: number;
  organizing: number;
  solidarity: number;
}

/** Các thành phần KPI theo Phụ lục 2 của 05-HD/TU, đều trong khoảng 0–1. */
export interface KpiBreakdown {
  quantity: number;
  quality: number;
  timeliness: number;
  leadership: number | null;
  kpi: number;
}

export interface EvaluationDetail {
  evaluation: EvaluationSummary & {
    selfGeneralScore: number | null;
    selfComment: string | null;
    generalScore: number | null;
    reviewComment: string | null;
    approveComment: string | null;
    returnReason: string | null;
    /** Hồ sơ năm đóng là "không xếp loại" (ADR-039): lý do. */
    notRatedReason: string | null;
    resultScore: number | null;
    leadership: Leadership | null;
    /** Vị trí hỗ trợ, phục vụ (ADR-053): ba tiêu chí tự đánh giá và do người quản lý đánh giá. */
    selfSupport: SupportScores | null;
    support: SupportScores | null;
    /** Tiêu chí chung chấm theo mục (ADR-054); null khi kỳ chấm một ô 0–30 hoặc chưa chấm. */
    selfGeneral: GeneralMarks | null;
    general: GeneralMarks | null;
    /** Tham số tính điểm lưu khi thẩm định; kỳ năm có `conditions`, `exception` (ADR-055). */
    scoringParams: { exception?: { code: string; note: string } } | null;
  };
  period: Period;
  tasks: EvaluationTask[];
  preview: { resultScore: number; totalScore: number | null; rating: RatingCode | null; complete: boolean; breakdown: KpiBreakdown | null };
  reviewerPersonId: string | null;
  approverPersonId: string | null;
  /** Cán bộ lãnh đạo, quản lý được chấm thêm tiêu chí D. */
  isLeader: boolean;
  /** Vị trí hỗ trợ, phục vụ: chấm ba tiêu chí a, b, c thay cho chỉ tiêu (ADR-053). */
  isSupport: boolean;
  leadershipSuggestion: { unitResult: number | null; solidarity: number | null; solidarityReason: string | null } | null;
  /** Kỳ năm: điểm các tháng đã phê duyệt và trung bình (ADR-035); null với kỳ khác. */
  yearAverage: YearAverage | null;
  warnings: string[];
  /** Bảng tiêu chí chung của hồ sơ (ADR-054); null với kỳ năm và kỳ chấm một ô 0–30. */
  generalCriteria: (GeneralCriteriaSet & { versionId: string; effectiveFrom: string; note: string | null; group: GeneralGroup; groupLabel: string }) | null;
  /** Hạn chế người thẩm định nêu ở kỳ cùng loại liền trước. */
  previous: { periodLabel: string; reviewComment: string | null; limitations: { code: string; name: string; note: string | null }[] } | null;
  /** Kỷ luật, kết luận... có hiệu lực trong kỳ (kỳ năm: cả năm) (ADR-055). */
  ratingEvents: RatingEvent[];
  /** Mục tiêu chí chung bắt buộc Không đảm bảo trong kỳ. */
  forcedItems: { code: string; reasons: string[] }[];
  /** Kỳ năm: điều kiện xếp loại "Không hoàn thành nhiệm vụ". */
  yearConditions: YearCondition[];
}

/** Sự kiện ảnh hưởng xếp loại (ADR-055). */
export type RatingEventKind = 'KY_LUAT' | 'SUY_THOAI' | 'TIN_NHIEM_THAP' | 'THAM_NHUNG_PHAM_VI';
export interface RatingEvent {
  id: string;
  personId: string;
  kind: RatingEventKind;
  effectiveDate: string;
  decisionNo: string;
  form: string | null;
  system: 'DANG' | 'HANH_CHINH' | null;
  reason: 'CONG_VU' | 'SUY_THOAI' | 'KHAC' | null;
  note: string | null;
}
export interface YearCondition {
  code: string;
  text: string;
  basis: string;
}
export const fetchRatingEvents = (personId: string, year: number) => serverFetch<RatingEvent[]>(`/evaluation/persons/${personId}/rating-events?year=${year}`);

/** Tiêu chí chung 30 điểm của cá nhân chấm theo mục (ADR-054). */
export type GeneralGroup = 'LEADER' | 'STAFF';
export interface GeneralSection {
  code: string;
  name: string;
}
export interface GeneralItem {
  code: string;
  section: string;
  name: string;
  max: number;
}
export interface GeneralCriteriaSet {
  sections: GeneralSection[];
  items: GeneralItem[];
}
export interface GeneralMark {
  code: string;
  ok: boolean;
  note: string | null;
}
export interface GeneralMarks {
  versionId: string;
  group: GeneralGroup;
  items: GeneralMark[];
}
export interface GeneralCriteriaVersion {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  leader: GeneralCriteriaSet;
  staff: GeneralCriteriaSet;
  note: string | null;
  createdAt: string;
  /** Kỳ đã có người tự chấm theo phiên bản này: không xóa được. */
  usedBy: string[];
}
export const fetchGeneralCriteria = () => serverFetch<GeneralCriteriaVersion[]>('/evaluation/general-criteria');

export interface MonthScore {
  month: number;
  label: string;
  generalScore: number;
  resultScore: number;
  totalScore: number;
}

/** Trung bình một quý hoặc 6 tháng đầu năm, chỉ để theo dõi (ADR-039). */
export interface PeriodAverage {
  key: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'H1';
  label: string;
  span: number[];
  approved: number;
  missing: number[];
  exempt: number[];
  totalScore: number | null;
  rating: RatingCode | null;
  complete: boolean;
}

export interface YearAverage {
  months: MonthScore[];
  missing: number[];
  /** Tháng nghỉ có căn cứ, không tính vào trung bình. */
  exempt: number[];
  enough: boolean;
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: RatingCode | null;
  periods: PeriodAverage[];
}

export type LeaveReason = 'OM' | 'THAI_SAN' | 'KHONG_LUONG' | 'KHAC';
export interface LeaveMonth {
  month: number;
  reason: LeaveReason;
  note: string | null;
}
export const fetchComplaints = (evaluationId: string) => serverFetch<UnitComplaint[]>(`/unit-complaint/evaluation/${evaluationId}`);
export const fetchLeave = (personId: string, year: number) => serverFetch<LeaveMonth[]>(`/evaluation/persons/${personId}/leave?year=${year}`);

export type ComplaintKind = 'KHIEU_NAI' | 'TO_CAO' | 'PHAN_ANH' | 'MAT_DOAN_KET';
export type ComplaintStatus = 'RECEIVED' | 'VERIFYING' | 'CLOSED';
export interface UnitComplaint {
  id: string;
  kind: ComplaintKind;
  content: string;
  source: string | null;
  receivedOn: string;
  status: ComplaintStatus;
  assignee: string | null;
  verifyDue: string | null;
  outcome: 'SUBSTANTIATED' | 'UNFOUNDED' | null;
  conclusion: string | null;
  closedAt: string | null;
}

export interface CatalogVersion {
  id: string;
  /** Tên danh mục. */
  name: string;
  /** Nhãn phiên bản: mã ngắn, duy nhất. */
  label: string;
  status: 'DRAFT' | 'APPROVED';
  baselineItemCode: string | null;
  effectiveFrom: string | null;
  approvedAt: string | null;
  sourceNote: string | null;
}

/** Nhiệm vụ của danh mục: tầng giữa Nhóm → Nhiệm vụ → Công việc (ADR-019). */
export interface CatalogTask {
  id: string;
  groupCode: string;
  name: string;
  description: string | null;
  /** Số công việc đang hoạt động (không tính công việc đã ngừng sử dụng). */
  itemCount: number;
  /** Xóa mềm (PLAN-A A1.6): nhiệm vụ ngừng sử dụng vẫn còn trong danh mục. */
  status: 'ACTIVE' | 'INACTIVE';
  inactiveReason: string | null;
}

export interface CatalogItem {
  id: string;
  /** Nhiệm vụ chứa công việc. */
  taskId: string;
  code: string;
  groupCode: string;
  name: string;
  productUnits: string | null;
  complexity: number;
  durationMode: 'LIMITED' | 'ACTUAL' | 'UNSPECIFIED';
  durationValue: number | null;
  durationUnit: 'HOUR' | 'DAY' | null;
  points: number | null;
  explanation: string | null;
  coefficient: number | null;
  needsScoring: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  inactiveReason: string | null;
  /** Phạm vi áp dụng (ADR-021): rỗng cả hai là việc chung. */
  unitIds: string[];
  positionIds: string[];
}

export interface CatalogVersionView {
  version: CatalogVersion;
  groups: { code: string; name: string }[];
  tasks: CatalogTask[];
  baseline: { code: string; points: number } | null;
  items: CatalogItem[];
  warnings: string[];
}

export interface AccountSummary {
  id: string;
  username: string;
  status: 'ACTIVE' | 'DISABLED';
  personId: string | null;
  lockedUntil: string | null;
}

export interface RoleAssignment {
  id: string;
  role: string;
  validFrom: string;
  validTo: string | null;
  revokedAt: string | null;
}

export type Gender = 'NAM' | 'NU' | 'KHAC';
export type PoliticalTheory = 'SO_CAP' | 'TRUNG_CAP' | 'CAO_CAP' | 'CU_NHAN';

/** Hồ sơ cán bộ mở rộng (ADR-023). Ngày sinh, CCCD, email, điện thoại chỉ có khi lấy hồ sơ đầy đủ (quyền quản lý tổ chức). */
export interface Person {
  id: string;
  fullName: string;
  note: string | null;
  active: boolean;
  employeeCode: string | null;
  gender: Gender | null;
  ethnicity: string | null;
  dateOfBirth?: string | null;
  nationalId?: string | null;
  email?: string | null;
  phone?: string | null;
  rank: string | null;
  salaryGrade: string | null;
  joinedAgencyOn: string | null;
  partyJoinedOn: string | null;
  education: string | null;
  major: string | null;
  politicalTheory: PoliticalTheory | null;
}

export interface Position {
  id: string;
  code: string;
  unitId: string;
  title: string;
  level: number;
  isLeader: boolean;
  isSupport: boolean;
  reportsToPositionId: string | null;
  duties: string | null;
  referenceOkr: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  inactiveReason: string | null;
}

/** PRIMARY: vị trí chính; CONCURRENT: kiêm nhiệm (ADR-047). */
export type AssignmentKind = 'PRIMARY' | 'CONCURRENT';

export interface Assignment {
  id: string;
  personId: string;
  positionId: string;
  kind: AssignmentKind;
  validFrom: string;
  validTo: string | null;
}

export const fetchPersons = () => serverFetch<Person[]>('/persons');
export const fetchPositions = (includeInactive = false) => serverFetch<Position[]>(`/positions${includeInactive ? '?includeInactive=true' : ''}`);

export const fetchCatalogVersions = () => serverFetch<CatalogVersion[]>('/catalog/versions');
export const fetchCatalogVersion = (id: string) => serverFetch<CatalogVersionView>(`/catalog/versions/${id}`);
export const fetchAccounts = () => serverFetch<AccountSummary[]>('/accounts');
export const fetchAccountRoles = (id: string) => serverFetch<RoleAssignment[]>(`/accounts/${id}/roles`);

export type ReportKind = 'MONTH' | 'QUARTER' | 'YEAR';
export type PeriodMode = 'AUTO' | 'MANUAL';
export type ProgressStatus = 'REPORTED' | 'CONFIRMED' | 'REJECTED';
export type AssignmentState = 'PROPOSED' | 'IN_PROGRESS' | 'PENDING_CONFIRM' | 'OVERDUE' | 'DONE' | 'CANCELLED';
export type SearchScope = 'mine' | 'team' | 'all' | 'consulted' | 'approving' | 'assigned';

export interface WorkAssignment {
  id: string;
  assigneePersonId: string;
  catalogItemCode: string;
  plannedQuantity: number;
  dueDate: string;
  periodMode: PeriodMode;
  reportKinds: ReportKind[];
  /** Nội dung việc. */
  note: string | null;
  /** PROPOSED: cán bộ đề xuất việc đột xuất, chờ cấp trên duyệt (ADR-046). */
  status: 'PROPOSED' | 'OPEN' | 'CANCELLED';
  /** CATALOG: việc trong danh mục. AD_HOC: việc đột xuất, ngoài kế hoạch, tính thêm điểm (ADR-046). */
  source: 'CATALOG' | 'AD_HOC';
  /** Tên việc đột xuất; null với việc trong danh mục. */
  title: string | null;
  /** Có giá trị khi việc do một mẫu việc lặp định kỳ sinh ra. */
  recurringTemplateId: string | null;
  recurringKey: string | null;
  /** Vị trí mà việc được giao cho (ADR-047); null: chưa xác định, hiểu là vị trí chính. */
  positionId: string | null;
  /** Ngày giao (ISO). */
  createdAt: string;
  /** Người duyệt (cc) do người giao chọn; null là cấp trên trực tiếp. */
  approverPersonId: string | null;
  /** Kết quả then chốt (OKR) của người nhận mà việc góp phần đạt, nhãn lưu lúc giao; chỉ để theo dõi (ADR-034). */
  okrKeyResult: string | null;
}

/** Một kết quả then chốt trong cột OKR của vị trí. */
export interface OkrKeyResult {
  code: string;
  text: string;
}

/** Cột OKR của vị trí đã tách thành Mục tiêu và các kết quả then chốt; `raw` rỗng là vị trí chưa có OKR. */
export interface Okr {
  raw: string;
  objective: string | null;
  keyResults: OkrKeyResult[];
}

export interface WorkProgress {
  id: string;
  assignmentId: string;
  quantity: number;
  completedOn: string;
  evidence: string | null;
  status: ProgressStatus;
  decisionNote: string | null;
  /** Chỉ có nghĩa khi bị từ chối: sai sót lớn về nội dung, bị trừ 25% điểm chất lượng. */
  majorError?: boolean;
}

/** Miễn trừ do nguyên nhân khách quan của một lần chậm hoặc chưa đạt (ADR-056); đã thu hồi thì có `revokedAt`. */
export interface WorkWaiver {
  id: string;
  progressId: string;
  kind: 'LATE' | 'REWORK';
  reason: string;
  grantedAt: string;
  revokedAt: string | null;
  revokeNote: string | null;
}

/** Nhiệm vụ do cấp trên đặt cho một cán bộ, chứa các công việc lấy từ danh mục. */
export interface WorkTask {
  id: string;
  assigneePersonId: string;
  title: string;
  description: string | null;
}

export interface AssignmentView {
  assignment: WorkAssignment;
  task: { id: string; title: string };
  itemName: string;
  coefficient: number | null;
  progress: WorkProgress[];
  waivers: WorkWaiver[];
  summary: { confirmedQuantity: number; pendingQuantity: number; reworkCount: number; lateCount: number; waivedLateCount: number; waivedReworkCount: number; done: boolean };
  /** Người xác nhận thực tế: người duyệt (cc) nếu có, không thì cấp trên trực tiếp. */
  confirmerPersonId: string | null;
  approverPersonId: string | null;
  consultantPersonIds: string[];
  state: AssignmentState;
  /** Mức độ khó (1 đến 4) của việc đột xuất; null với việc trong danh mục. */
  adHocLevel: number | null;
}

export type AssignmentScope = 'mine' | 'team' | 'all';

export interface CatalogCurrent {
  version: { id: string; label: string };
  groups: { code: string; name: string }[];
  tasks: CatalogTask[];
  items: CatalogItem[];
}

export const fetchWorkTasks = (scope: AssignmentScope) => serverFetch<WorkTask[]>(`/tasking/tasks?scope=${scope}`);
export const fetchAssignments = (scope: AssignmentScope) => serverFetch<AssignmentView[]>(`/tasking/assignments?scope=${scope}`);
export const fetchOkr = (personId: string) => serverFetch<Okr>(`/tasking/okr/${personId}`);
export const fetchCatalogCurrent = () => serverFetch<CatalogCurrent>('/catalog/current');

export const fetchPeriods = () => serverFetch<Period[]>('/evaluation/periods');
export const fetchEvaluations = (periodId: string) => serverFetch<EvaluationSummary[]>(`/evaluation/periods/${periodId}/evaluations`);
export const fetchEvaluation = (id: string) => serverFetch<EvaluationDetail>(`/evaluation/evaluations/${id}`);
/** Số liệu tham chiếu từ việc được giao trong năm của đơn vị (ADR-030 mục 4). */
export interface UnitMetrics {
  works: number;
  completed: number;
  onTime: number;
  exceeded: number;
  late: number;
}

export interface UnitEvaluationRecord {
  id: string;
  periodId: string;
  unitId: string;
  status: EvaluationStatus;
  selfGeneralScore: number | null;
  selfResultScore: number | null;
  selfComment: string | null;
  generalScore: number | null;
  resultScore: number | null;
  reviewComment: string | null;
  approveComment: string | null;
  returnReason: string | null;
  totalScore: number | null;
  rating: RatingCode | null;
  /** Điểm từng trục khi tự chấm và khi thẩm định, kèm ảnh chụp định nghĩa trục (ADR-036); null khi nhập một số. */
  selfAxisScores: AxisScore[] | null;
  axisScores: AxisScore[] | null;
}

export type AxisKind = 'GENERAL' | 'RESULT';

/** Ba tiêu chí của người lao động hỗ trợ, phục vụ, mỗi tiêu chí 0–100% (ADR-053). */
export interface SupportScores {
  quality: number;
  compliance: number;
  efficiency: number;
}

/** Một trục chấm điểm tập thể (ADR-036). */
export interface AxisDefinition {
  code: string;
  name: string;
  kind: AxisKind;
  maxPoints: number;
  sortOrder: number;
  autoMetric: 'COMPLETED_SHARE' | null;
  active: boolean;
}

export interface AxisScore {
  code: string;
  name: string;
  kind: AxisKind;
  max: number;
  score: number;
}

export interface UnitEvaluationView {
  evaluation: UnitEvaluationRecord;
  period: Period;
  unit: { id: string; code: string; name: string; type: 'BAN' | 'PHONG' };
  headPersonId: string | null;
  metrics: UnitMetrics;
  proposedRating: RatingCode | null;
  warnings: string[];
  /** Các trục đang bật khi chấm điểm; rỗng là nhập một số cho cả hai nhóm (ADR-036). */
  axes: AxisDefinition[];
  /** Điểm gợi ý theo số liệu tham chiếu, theo mã trục. */
  suggested: Record<string, number>;
  /** Hạn hoàn thành đánh giá năm (ADR-038). */
  deadline: Deadline | null;
  /** Khiếu nại, phản ánh chưa kết luận; chặn công nhận. Người đứng đầu và thành viên luôn thấy 0. */
  openComplaints: number;
}

/** Một bộ trục: bộ mặc định (`unitId` null) hoặc bộ đang áp dụng cho một đơn vị (ADR-052). */
export interface AxisSet {
  unitId: string | null;
  unitCode: string | null;
  unitName: string | null;
  /** Đơn vị có bộ riêng; false là đang dùng bộ mặc định. */
  own: boolean;
  axes: AxisDefinition[];
}

export const fetchUnitAxes = () => serverFetch<AxisDefinition[]>('/unit-evaluation/axes');
export const fetchAxisSets = () => serverFetch<AxisSet[]>('/unit-evaluation/axis-sets');
export const fetchUnitEvaluations = (periodId: string) => serverFetch<UnitEvaluationView[]>(`/unit-evaluation/periods/${periodId}`);
export const fetchUnitEvaluation = (id: string) => serverFetch<UnitEvaluationView>(`/unit-evaluation/${id}`);
export interface UnitReportRow {
  evaluationId: string;
  unitCode: string;
  unitName: string;
  unitType: 'BAN' | 'PHONG';
  headName: string;
  status: EvaluationStatus;
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: RatingCode | null;
  warnings: number;
  axes: { code: string; name: string; kind: AxisKind; maxPoints: number; points: number }[];
}

export interface AxisSummary {
  code: string;
  name: string;
  kind: AxisKind;
  maxPoints: number;
  count: number;
  average: number | null;
  ratio: number | null;
  lowest: number | null;
}

export interface UnitReport {
  period: Period;
  scope: 'ALL' | 'LIMITED';
  units: number;
  approved: number;
  pendingApproval: number;
  inProgress: number;
  ratings: Record<RatingCode, number>;
  averageTotal: number | null;
  quota: { excellent: number; good: number; allowed: number; exceeded: boolean };
  axisSummary: AxisSummary[];
  rows: UnitReportRow[];
  notes: string[];
}

export const fetchUnitReport = (periodId: string) => serverFetch<UnitReport>(`/reporting/periods/${periodId}/units`);
export const fetchUnitDraft = (periodId: string) => serverFetch<Draft>(`/reporting/periods/${periodId}/units/draft`);
export interface AuditEntry {
  id: string;
  occurredAt: string;
  actorAccountId: string | null;
  actorUsername: string | null;
  action: string;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  /** Mô-đun và loại thao tác (PLAN-A A5); bản ghi cũ được máy chủ suy từ `action`. */
  module: string;
  type: string;
  hashVersion: number;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  requestId: string | null;
  ip: string | null;
  prevHash: string;
  hash: string;
}

export interface AuditVerification {
  valid: boolean;
  checked: number;
  lastId: string | null;
  lastHash: string;
  firstInvalidId?: string;
  reason?: string;
}

export const fetchAuditLogs = (query: string) => serverFetch<AuditEntry[]>(`/audit-logs?${query}`);
export const fetchAuditActions = () => serverFetch<string[]>('/audit-logs/actions');
export const fetchAuditFacets = () => serverFetch<{ modules: string[]; types: string[] }>('/audit-logs/facets');
export const fetchDashboard = (periodId: string) => serverFetch<PeriodReport>(`/reporting/periods/${periodId}/dashboard`);
export const fetchDraft = (periodId: string, kind: 'report' | 'decision' | 'notice') =>
  serverFetch<Draft>(`/reporting/periods/${periodId}/draft?kind=${kind}`);

export interface SearchResult {
  items: AssignmentView[];
  total: number;
  page: number;
  pageSize: number;
  stateCounts: Record<AssignmentState, number>;
}

export interface WorkComment {
  id: string;
  assignmentId: string;
  authorAccountId: string;
  authorPersonId: string | null;
  kind: 'MESSAGE' | 'OPINION';
  body: string;
  createdAt: string;
}

export interface WorkAttachment {
  id: string;
  assignmentId: string;
  commentId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByAccountId: string;
  uploadedAt: string;
}

export interface Conversation {
  comments: WorkComment[];
  attachments: WorkAttachment[];
}

/** Rà soát quyền định kỳ (ADR-044). */
export interface AccessReviewView {
  id: string;
  year: number;
  quarter: number;
  label: string;
  status: 'OPEN' | 'CLOSED';
  /** YYYY-MM-DD theo giờ Việt Nam. */
  dueDate: string;
  note: string | null;
  createdAt: string;
  closedAt: string | null;
  counts: { total: number; decided: number; pending: number; keep: number; revoke: number };
  overdue: boolean;
}

export interface AccessReviewItem {
  id: string;
  accountId: string;
  username: string;
  personId: string | null;
  personName: string | null;
  unitName: string | null;
  positionTitle: string | null;
  role: string;
  roleValidFrom: string;
  roleValidTo: string | null;
  reviewerKind: 'LEADER' | 'DATA_ADMIN';
  reviewerName: string | null;
  decision: 'KEEP' | 'REVOKE' | null;
  decidedAt: string | null;
  note: string | null;
  revokeApplied: boolean;
}

export interface AccessReviewDetail {
  review: AccessReviewView;
  items: (AccessReviewItem & { canDecide: boolean })[];
}

export interface AccessReviewSuggestion {
  year: number;
  quarter: number;
  label: string;
  exists: boolean;
  reviewId: string | null;
}

export const fetchAccessReviews = () => serverFetch<AccessReviewView[]>('/access-reviews');
export const fetchAccessReview = (id: string) => serverFetch<AccessReviewDetail>(`/access-reviews/${id}`);
export const fetchAccessReviewSuggestion = () => serverFetch<AccessReviewSuggestion>('/access-reviews/suggestion');

/** Mẫu việc lặp định kỳ (ADR-046). */
export type RecurringFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export interface RecurringTemplate {
  id: string;
  assigneePersonId: string;
  taskId: string;
  source: 'CATALOG' | 'AD_HOC';
  catalogItemCode: string;
  title: string | null;
  plannedQuantity: number;
  frequency: RecurringFrequency;
  startDate: string;
  endDate: string | null;
  dueAfterDays: number;
  periodMode: PeriodMode;
  reportKinds: ReportKind[];
  note: string | null;
  approverPersonId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdBy: string;
  createdAt: string;
  lastRunAt: string | null;
  lastError: string | null;
  generatedCount: number;
  nextOccurrence: string | null;
}

export const fetchRecurring = () => serverFetch<RecurringTemplate[]>('/tasking/recurring');

/** Thống kê việc theo bộ lọc (PLAN-A A6.4). */
export interface TaskGroupStats {
  total: number;
  done: number;
  overdue: number;
  late: number;
  rework: number;
  lateRate: number | null;
  reworkRate: number | null;
}

export interface TaskStatistics {
  byState: Record<AssignmentState, number>;
  overall: TaskGroupStats;
  byUnit: ({ unitName: string } & TaskGroupStats)[];
}

/** Loại việc để lọc: giao từ danh mục, đột xuất, hoặc do mẫu lặp định kỳ sinh ra. */
export type WorkKind = 'CATALOG' | 'AD_HOC' | 'RECURRING';

/** Giải thích điểm và mô phỏng của một hồ sơ (GET /evaluation/evaluations/:id/insight). */
export interface InsightComponent {
  key: string;
  label: string;
  basis: string;
  rate: number | null;
  points: number;
  maxPoints: number;
  lostPoints: number;
}
export interface InsightLine {
  taskId: string;
  code: string;
  name: string;
  coefficient: number;
  planned: number;
  completed: number;
  accepted: number;
  extra: boolean;
  share: number | null;
  pendingQuality: boolean;
  lateCount: number;
  reworkCount: number;
  points: number;
  lostQuantity: number;
  lostQuality: number;
  lostTimeliness: number;
}
export interface ScoreExplanation {
  isLeader: boolean;
  componentCount: 3 | 6;
  components: InsightComponent[];
  lines: InsightLine[];
  resultScore: number;
  resultMax: number;
  generalScore: number | null;
  totalScore: number | null;
  rating: RatingCode | null;
  capped: string[];
  notes: string[];
}
export interface InsightMove {
  kind: 'COMPLETE' | 'LATE' | 'REWORK';
  taskId: string;
  code: string;
  name: string;
  text: string;
  deltaResult: number;
  ratingAfter: RatingCode | null;
}
export interface InsightGoal {
  current: RatingCode;
  next: RatingCode | null;
  threshold: number | null;
  missing: number;
  ceiling: number;
  reachable: boolean;
  steps: InsightMove[];
}
export interface InsightView {
  supported: boolean;
  reason?: string;
  frozen: boolean;
  explanation: ScoreExplanation | null;
  suggestions: { opportunities: InsightMove[]; risks: InsightMove[]; goal: InsightGoal | null } | null;
  tasks: { taskId: string; code: string; name: string; planned: number; completed: number; lateCount: number; reworkCount: number; qualityLevel: number | null; extra: boolean }[];
  generalScore: number | null;
  isLeader: boolean;
}
export interface Simulation {
  base: { resultScore: number; totalScore: number | null; rating: RatingCode | null };
  result: { resultScore: number; totalScore: number | null; rating: RatingCode | null };
  explanation: ScoreExplanation;
  deltaResult: number;
  deltaTotal: number | null;
}

/** Cảnh báo sớm việc có nguy cơ chậm (GET /tasking/assignments/early-warning). */
export interface WarningItem {
  assignmentId: string;
  level: 'HIGH' | 'MEDIUM';
  kind: 'OVERDUE' | 'DUE_SOON' | 'BEHIND_PACE';
  title: string;
  taskTitle: string;
  assigneePersonId: string;
  assigneeName?: string;
  dueDate: string;
  daysLeft: number;
  planned: number;
  done: number;
  elapsedPct: number;
  donePct: number;
  text: string;
}
export interface EarlyWarning {
  today: string;
  high: number;
  medium: number;
  items: WarningItem[];
  byAssignee: { personId: string; name?: string; high: number; medium: number }[];
}

// ---- Đề án, dự án (ADR-050)

export type ProjectKind = 'DE_AN' | 'DU_AN';
export type ProjectStatus = 'DRAFT' | 'SUBMITTED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Project {
  id: string;
  code: string;
  kind: ProjectKind;
  title: string;
  objective: string | null;
  description: string | null;
  ownerPersonId: string;
  unitId: string | null;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  createdByAccountId: string;
  submittedAt: string | null;
  approvedByAccountId: string | null;
  approvedAt: string | null;
  /** Lý do trả lại gần nhất (còn khi hồ sơ đã về DRAFT). */
  returnReason: string | null;
  /** Ngày nghiệm thu và nhận xét, hoặc lý do hủy. */
  completedOn: string | null;
  closeNote: string | null;
  createdAt: string;
}

export interface ProjectProgress {
  /** Tỷ lệ hoàn thành theo trọng số mốc, 0–1; null khi chưa có mốc. */
  ratio: number | null;
  total: number;
  done: number;
  overdue: number;
  nextDue: string | null;
}

export interface ProjectRow {
  project: Project;
  ownerName: string;
  unitName: string;
  progress: ProjectProgress;
  memberCount: number;
  workCount: number;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  dueDate: string;
  weight: number;
  assigneePersonId: string | null;
  status: 'PENDING' | 'DONE';
  completedOn: string | null;
  note: string | null;
  createdAt: string;
  assigneeName: string | null;
  overdue: boolean;
}

export interface ProjectAttachment {
  id: string;
  projectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByAccountId: string;
  createdAt: string;
}

/** Việc được giao gắn vào đề án (tóm tắt). */
export interface ProjectWork {
  assignmentId: string;
  title: string;
  taskTitle: string;
  assigneePersonId: string;
  dueDate: string;
  state: string;
  plannedQuantity: number;
  confirmedQuantity: number;
  lateCount: number;
  reworkCount: number;
  assigneeName?: string;
}

export interface ProjectCan {
  edit: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  complete: boolean;
  cancel: boolean;
  manageMilestones: boolean;
  link: boolean;
  upload: boolean;
}

export interface ProjectDetail {
  project: Project;
  ownerName: string;
  unitName: string;
  members: { projectId: string; personId: string; role: 'LEAD' | 'MEMBER'; fullName: string }[];
  milestones: ProjectMilestone[];
  progress: ProjectProgress;
  attachments: ProjectAttachment[];
  work: (ProjectWork & { assigneeName: string })[];
  can: ProjectCan;
}

export interface ProjectStatistics {
  total: number;
  byStatus: Record<ProjectStatus, number>;
  byKind: Record<ProjectKind, number>;
  active: { count: number; averageProgress: number | null; withOverdueMilestones: number; overdueMilestones: number; pastEndDate: number };
  byUnit: { unitName: string; total: number; active: number; completed: number }[];
}

export interface ProjectWarning {
  level: 'HIGH' | 'MEDIUM';
  kind: 'MILESTONE_OVERDUE' | 'MILESTONE_DUE_SOON' | 'PROJECT_PAST_END';
  projectId: string;
  projectCode: string;
  projectTitle: string;
  ownerPersonId: string;
  ownerName: string;
  milestoneId: string | null;
  milestoneTitle: string | null;
  assigneePersonId: string | null;
  dueDate: string;
  daysLeft: number;
  text: string;
}

export interface ProjectWarnings {
  today: string;
  high: number;
  medium: number;
  items: ProjectWarning[];
}

export const fetchProject = (id: string) => serverFetch<ProjectDetail>(`/projects/${id}`);

/** Lịch họp (ADR-051): khớp `MeetingService` của máy chủ. Thời điểm là chuỗi ISO 8601 (UTC), hiển thị theo giờ Việt Nam. */
export type MeetingStatus = 'SCHEDULED' | 'HELD' | 'CANCELLED';
export type MeetingRole = 'ORGANIZER' | 'REQUIRED' | 'OPTIONAL';
export type MeetingResponse = 'PENDING' | 'ACCEPTED' | 'DECLINED';

export interface Meeting {
  id: string;
  title: string;
  agenda: string | null;
  startAt: string;
  endAt: string;
  location: string | null;
  onlineLink: string | null;
  /** Phòng họp chọn từ danh mục; null nếu địa điểm là chữ tự do. */
  roomId: string | null;
  organizerPersonId: string;
  createdByAccountId: string;
  projectId: string | null;
  status: MeetingStatus;
  cancelReason: string | null;
  conclusion: string | null;
  concludedAt: string | null;
  createdAt: string;
}

export interface MeetingRow {
  meeting: Meeting;
  organizerName: string;
  attendeeCount: number;
  accepted: number;
  declined: number;
  myResponse: MeetingResponse | null;
  myRole: MeetingRole | null;
  project: { code: string; title: string } | null;
  actionCount: number;
  actionsOpen: number;
}

export interface MeetingConflict {
  personId: string;
  personName: string;
  /** null: người xem không xem được cuộc họp kia (chỉ biết là bận). */
  meetingId: string | null;
  title: string | null;
  startAt: string;
  endAt: string;
}

export interface MeetingAttendee {
  meetingId: string;
  personId: string;
  role: MeetingRole;
  response: MeetingResponse;
  respondedAt: string | null;
  note: string | null;
  attended: boolean | null;
  fullName: string;
}

export interface MeetingAction {
  id: string;
  meetingId: string;
  content: string;
  assigneePersonId: string;
  dueDate: string;
  status: 'PENDING' | 'DONE';
  completedOn: string | null;
  createdAt: string;
  assigneeName: string;
  overdue: boolean;
}

export interface MeetingAttachment {
  id: string;
  meetingId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByAccountId: string;
  createdAt: string;
}

export interface MeetingCan {
  edit: boolean;
  cancel: boolean;
  respond: boolean;
  conclude: boolean;
  manageActions: boolean;
  upload: boolean;
}

/** Phòng họp trong danh mục (GET /meetings/rooms). */
export interface MeetingRoom {
  id: string;
  name: string;
  capacity: number | null;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

/** Cuộc họp khác dùng cùng phòng vào giờ chồng lên; title null nếu người xem không xem được cuộc họp đó. */
export interface MeetingRoomConflict {
  meetingId: string | null;
  title: string | null;
  startAt: string;
  endAt: string;
}

export interface MeetingDetail {
  meeting: Meeting;
  organizerName: string;
  project: { code: string; title: string } | null;
  attendees: MeetingAttendee[];
  actions: MeetingAction[];
  attachments: MeetingAttachment[];
  conflicts: MeetingConflict[];
  room: MeetingRoom | null;
  roomConflicts: MeetingRoomConflict[];
  myResponse: MeetingResponse | null;
  can: MeetingCan;
}

export interface MyMeetingAction {
  action: Omit<MeetingAction, 'assigneeName' | 'overdue'>;
  meetingTitle: string;
  overdue: boolean;
}

export const fetchMeeting = (id: string) => serverFetch<MeetingDetail>(`/meetings/${id}`);
