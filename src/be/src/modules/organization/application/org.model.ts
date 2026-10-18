import type { InactiveInfo } from './unit.model.js';

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;

/** Cấp lớn nhất được coi là lãnh đạo, quản lý khi chưa chọn cờ riêng (ADR-022): Trưởng ban đến Phó phòng. */
export const DEFAULT_LEADER_MAX_LEVEL = 4;
export const defaultIsLeader = (level: number): boolean => level <= DEFAULT_LEADER_MAX_LEVEL;

export const GENDERS = ['NAM', 'NU', 'KHAC'] as const;
export type Gender = (typeof GENDERS)[number];
export const POLITICAL_THEORY_LEVELS = ['SO_CAP', 'TRUNG_CAP', 'CAO_CAP', 'CU_NHAN'] as const;
export type PoliticalTheory = (typeof POLITICAL_THEORY_LEVELS)[number];

/**
 * Hồ sơ cán bộ mở rộng (ADR-023), chọn theo Công văn 1638-CV/TU (mức chia sẻ 1 và 2). Không lưu dữ liệu mức 3
 * (lịch sử bản thân, tài sản thu nhập, quan hệ gia đình): thuộc bảo vệ chính trị nội bộ, ngoài phạm vi hệ thống KPI.
 */
export interface PersonProfile {
  /** Mã cán bộ nội bộ, không trùng. */
  employeeCode: string | null;
  gender: Gender | null;
  ethnicity: string | null;
  /** Dạng YYYY-MM-DD. Nhạy cảm: chỉ người có quyền quản lý thấy. */
  dateOfBirth: string | null;
  /** Số định danh cá nhân (CCCD), 12 chữ số, không trùng. Nhạy cảm. */
  nationalId: string | null;
  /** Nhạy cảm. */
  email: string | null;
  /** Nhạy cảm. */
  phone: string | null;
  /** Ngạch công chức. */
  rank: string | null;
  /** Bậc lương. */
  salaryGrade: string | null;
  joinedAgencyOn: string | null;
  partyJoinedOn: string | null;
  /** Trình độ chuyên môn (đại học, thạc sĩ...). */
  education: string | null;
  major: string | null;
  politicalTheory: PoliticalTheory | null;
}

export const PERSON_PROFILE_FIELDS = [
  'employeeCode', 'gender', 'ethnicity', 'dateOfBirth', 'nationalId', 'email', 'phone',
  'rank', 'salaryGrade', 'joinedAgencyOn', 'partyJoinedOn', 'education', 'major', 'politicalTheory',
] as const satisfies readonly (keyof PersonProfile)[];

/** Trường chỉ người có quyền `org:manage` được xem (dữ liệu cá nhân nhạy cảm). */
export const SENSITIVE_PERSON_FIELDS = ['dateOfBirth', 'nationalId', 'email', 'phone'] as const satisfies readonly (keyof PersonProfile)[];

export const EMPTY_PROFILE: PersonProfile = Object.fromEntries(PERSON_PROFILE_FIELDS.map((f) => [f, null])) as unknown as PersonProfile;

export interface PersonModel extends PersonProfile {
  id: string;
  fullName: string;
  note: string | null;
  active: boolean;
}
export type NewPerson = Pick<PersonModel, 'fullName' | 'note'> & Partial<PersonProfile>;
export type PersonPatch = Partial<Pick<PersonModel, 'fullName' | 'note'> & PersonProfile>;

/** Hồ sơ đã bỏ các trường nhạy cảm, để trả cho người chỉ có quyền xem. */
export type PublicPerson = Omit<PersonModel, (typeof SENSITIVE_PERSON_FIELDS)[number]>;

export function toPublicPerson(person: PersonModel): PublicPerson {
  const copy: Partial<PersonModel> = { ...person };
  for (const f of SENSITIVE_PERSON_FIELDS) delete copy[f];
  return copy as PublicPerson;
}

/** Vị trí việc làm: một "ô" trong sơ đồ tổ chức, tách khỏi người đang giữ (ADR-012). */
export interface PositionModel extends InactiveInfo {
  id: string;
  /** Mã ổn định, duy nhất, để nhập lại từ Excel không tạo trùng. */
  code: string;
  unitId: string;
  title: string;
  /** 1 = Trưởng ban, 2 = Phó Trưởng ban, 3 = Trưởng phòng, 4 = Phó phòng, 5 = chuyên viên và tương đương. */
  level: number;
  /** Giữ vị trí này là cán bộ lãnh đạo, quản lý: KPI chia 6 và chấm thêm ba tiêu chí d, đ, e (ADR-022). */
  isLeader: boolean;
  /**
   * Vị trí của người lao động làm công tác hỗ trợ, phục vụ (lái xe, phục vụ, lễ tân, bảo vệ...): kết quả chấm theo ba tiêu chí
   * chất lượng, tuân thủ quy trình, hiệu quả thay cho công thức sản phẩm (Sổ tay Bộ Nội vụ Chương III, ADR-053). Không đồng thời là lãnh đạo.
   */
  isSupport: boolean;
  reportsToPositionId: string | null;
  duties: string | null;
  /** KPI/OKR then chốt nhập từ Excel, chỉ để tham khảo, chưa là tiêu chí chấm điểm (ADR-012). */
  referenceOkr: string | null;
}
/** Không nêu `isLeader` thì lấy theo cấp (`defaultIsLeader`); vị trí hỗ trợ, phục vụ thì không là lãnh đạo. Không nêu `isSupport` là false. */
export type NewPosition = Omit<PositionModel, 'id' | 'isLeader' | 'isSupport' | keyof InactiveInfo> & { isLeader?: boolean; isSupport?: boolean };
export type PositionPatch = Partial<Omit<PositionModel, 'id' | 'code' | keyof InactiveInfo>>;

/** PRIMARY: vị trí chính (mỗi cán bộ tối đa một tại mỗi thời điểm). CONCURRENT: kiêm nhiệm, được có nhiều cùng lúc (ADR-047). */
export const ASSIGNMENT_KINDS = ['PRIMARY', 'CONCURRENT'] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export interface AssignmentModel {
  id: string;
  personId: string;
  positionId: string;
  kind: AssignmentKind;
  validFrom: Date;
  /** null: đang giữ, chưa kết thúc. */
  validTo: Date | null;
}
export type NewAssignment = Omit<AssignmentModel, 'id'>;

interface Period {
  validFrom: Date;
  validTo: Date | null;
}

/** Hai khoảng thời gian [from, to) có giao nhau không (to = null nghĩa là chưa kết thúc). */
export function overlaps(a: Period, b: Period): boolean {
  const aEnd = a.validTo?.getTime() ?? Infinity;
  const bEnd = b.validTo?.getTime() ?? Infinity;
  return a.validFrom.getTime() < bEnd && b.validFrom.getTime() < aEnd;
}

/** Đang giữ vị trí tại thời điểm `at`. */
export function isCurrent(a: AssignmentModel, at: Date): boolean {
  return a.validFrom <= at && (a.validTo === null || a.validTo > at);
}
