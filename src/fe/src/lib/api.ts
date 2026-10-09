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
  reportsToPositionId: string | null;
  holder: { personId: string; fullName: string } | null;
}

export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  type: 'BAN' | 'PHONG';
  parentId: string | null;
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
export const fetchOrgTree = () => serverFetch<OrgUnit[]>('/org/tree');

export interface Period {
  id: string;
  /** Phiên bản danh mục đã phê duyệt dùng cho kỳ này. */
  catalogVersionId?: string;
  type: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface Stats {
  evaluations: number;
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
  kind: 'REPORT' | 'DECISION';
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
    resultScore: number | null;
    leadership: Leadership | null;
  };
  period: Period;
  tasks: EvaluationTask[];
  preview: { resultScore: number; totalScore: number | null; rating: RatingCode | null; complete: boolean; breakdown: KpiBreakdown | null };
  reviewerPersonId: string | null;
  approverPersonId: string | null;
  /** Cán bộ lãnh đạo, quản lý được chấm thêm tiêu chí D. */
  isLeader: boolean;
  leadershipSuggestion: { unitResult: number | null } | null;
  warnings: string[];
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
  itemCount: number;
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
  reportsToPositionId: string | null;
  duties: string | null;
  referenceOkr: string | null;
}

export interface Assignment {
  id: string;
  personId: string;
  positionId: string;
  validFrom: string;
  validTo: string | null;
}

export const fetchPersons = () => serverFetch<Person[]>('/persons');
export const fetchPositions = () => serverFetch<Position[]>('/positions');

export const fetchCatalogVersions = () => serverFetch<CatalogVersion[]>('/catalog/versions');
export const fetchCatalogVersion = (id: string) => serverFetch<CatalogVersionView>(`/catalog/versions/${id}`);
export const fetchAccounts = () => serverFetch<AccountSummary[]>('/accounts');
export const fetchAccountRoles = (id: string) => serverFetch<RoleAssignment[]>(`/accounts/${id}/roles`);

export type ReportKind = 'MONTH' | 'QUARTER' | 'YEAR';
export type PeriodMode = 'AUTO' | 'MANUAL';
export type ProgressStatus = 'REPORTED' | 'CONFIRMED' | 'REJECTED';
export type AssignmentState = 'IN_PROGRESS' | 'PENDING_CONFIRM' | 'OVERDUE' | 'DONE' | 'CANCELLED';
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
  status: 'OPEN' | 'CANCELLED';
  /** Ngày giao (ISO). */
  createdAt: string;
  /** Người duyệt (cc) do người giao chọn; null là cấp trên trực tiếp. */
  approverPersonId: string | null;
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
  summary: { confirmedQuantity: number; pendingQuantity: number; reworkCount: number; lateCount: number; done: boolean };
  /** Người xác nhận thực tế: người duyệt (cc) nếu có, không thì cấp trên trực tiếp. */
  confirmerPersonId: string | null;
  approverPersonId: string | null;
  consultantPersonIds: string[];
  state: AssignmentState;
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
export const fetchCatalogCurrent = () => serverFetch<CatalogCurrent>('/catalog/current');

export const fetchPeriods = () => serverFetch<Period[]>('/evaluation/periods');
export const fetchEvaluations = (periodId: string) => serverFetch<EvaluationSummary[]>(`/evaluation/periods/${periodId}/evaluations`);
export const fetchEvaluation = (id: string) => serverFetch<EvaluationDetail>(`/evaluation/evaluations/${id}`);
export const fetchDashboard = (periodId: string) => serverFetch<PeriodReport>(`/reporting/periods/${periodId}/dashboard`);
export const fetchDraft = (periodId: string, kind: 'report' | 'decision') =>
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
