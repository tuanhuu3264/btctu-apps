import { BadRequestException } from '@nestjs/common';
import { MAX_GENERAL_SCORE } from '../../scoring/index.js';

/**
 * Tiêu chí chung 30 điểm của cá nhân chấm theo mục con (ADR-054, bộ tiêu chí mục 2.1):
 * - lãnh đạo, quản lý theo 05-HD/TU Phụ lục 03 (Mẫu 5, phần A);
 * - công chức không giữ chức vụ, người lao động hỗ trợ, phục vụ theo Nghị định 335 Phụ lục II Mẫu số 01.
 * Mỗi mục chấm "Đảm bảo" (điểm tối đa của mục) hoặc "Không đảm bảo" (0 điểm, phải ghi căn cứ).
 */
export type GeneralGroup = 'LEADER' | 'STAFF';

export const GENERAL_GROUP_LABELS: Record<GeneralGroup, string> = {
  LEADER: 'Cá nhân giữ chức vụ lãnh đạo, quản lý',
  STAFF: 'Công chức không giữ chức vụ; người lao động hỗ trợ, phục vụ',
};

/** Một nhóm tiêu chí (1, 2, 3 hoặc I, II, III) chứa các mục con. */
export interface GeneralSection {
  code: string;
  name: string;
}

export interface GeneralItem {
  code: string;
  /** Mã nhóm chứa mục này. */
  section: string;
  name: string;
  max: number;
}

export interface GeneralCriteriaSet {
  sections: GeneralSection[];
  items: GeneralItem[];
}

/** Một phiên bản bảng tiêu chí chung, áp dụng cho các kỳ bắt đầu từ `effectiveFrom` (ngày 01 của tháng). */
export interface GeneralCriteriaVersion {
  id: string;
  effectiveFrom: string;
  leader: GeneralCriteriaSet;
  staff: GeneralCriteriaSet;
  /** Căn cứ của phiên bản (văn bản, quyết định). */
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}
export type NewGeneralCriteriaVersion = Omit<GeneralCriteriaVersion, 'id' | 'createdAt'>;

/** Kết quả chấm một mục. */
export interface GeneralMark {
  code: string;
  ok: boolean;
  /** Căn cứ; bắt buộc khi Không đảm bảo hoặc khi người thẩm định chấm khác người tự chấm. */
  note: string | null;
}

/** Kết quả chấm tiêu chí chung lưu trong hồ sơ: chấm theo phiên bản và bảng nào. */
export interface GeneralMarks {
  versionId: string;
  group: GeneralGroup;
  items: GeneralMark[];
}

export abstract class GeneralCriteriaRepository {
  /** Mọi phiên bản, cũ trước. */
  abstract findAll(): Promise<GeneralCriteriaVersion[]>;
  abstract findById(id: string): Promise<GeneralCriteriaVersion | null>;
  abstract create(data: NewGeneralCriteriaVersion): Promise<GeneralCriteriaVersion>;
  abstract delete(id: string): Promise<void>;
}

/** Phiên bản áp dụng cho kỳ bắt đầu ngày `startDate`: phiên bản có ngày áp dụng gần nhất không sau ngày đó. */
export function effectiveVersion(versions: readonly GeneralCriteriaVersion[], startDate: string): GeneralCriteriaVersion | null {
  let found: GeneralCriteriaVersion | null = null;
  for (const v of versions) if (v.effectiveFrom <= startDate && (!found || v.effectiveFrom > found.effectiveFrom)) found = v;
  return found;
}

export const setOf = (version: GeneralCriteriaVersion, group: GeneralGroup): GeneralCriteriaSet => (group === 'LEADER' ? version.leader : version.staff);

const MAX_NOTE = 1000;
const MAX_ITEMS = 40;
const CODE = /^[0-9IVX]{1,4}(\.[0-9]{1,2})?$/;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Kiểm tra một bảng khi cấu hình: mã không trùng, mỗi mục thuộc một nhóm có thật, điểm là bội số 0,5, tổng đúng 30. */
export function validateSet(set: GeneralCriteriaSet, label: string): GeneralCriteriaSet {
  if (!set || !Array.isArray(set.sections) || !Array.isArray(set.items)) throw new BadRequestException(`${label}: thiếu danh sách nhóm hoặc mục`);
  if (set.items.length === 0 || set.items.length > MAX_ITEMS) throw new BadRequestException(`${label}: cần từ 1 đến ${MAX_ITEMS} mục`);
  const sections = new Set<string>();
  for (const s of set.sections) {
    if (!CODE.test(s.code ?? '') || sections.has(s.code)) throw new BadRequestException(`${label}: mã nhóm "${s.code}" không hợp lệ hoặc bị trùng`);
    if (!s.name?.trim()) throw new BadRequestException(`${label}: nhóm ${s.code} chưa có tên`);
    sections.add(s.code);
  }
  const codes = new Set<string>();
  for (const i of set.items) {
    if (!CODE.test(i.code ?? '') || codes.has(i.code) || sections.has(i.code)) throw new BadRequestException(`${label}: mã mục "${i.code}" không hợp lệ hoặc bị trùng`);
    if (!sections.has(i.section)) throw new BadRequestException(`${label}: mục ${i.code} thuộc nhóm "${i.section}" không có trong bảng`);
    if (!i.name?.trim()) throw new BadRequestException(`${label}: mục ${i.code} chưa có nội dung`);
    if (!Number.isFinite(i.max) || i.max <= 0 || Math.round(i.max * 2) !== i.max * 2) throw new BadRequestException(`${label}: điểm tối đa của mục ${i.code} phải lớn hơn 0 và là bội số của 0,5`);
    codes.add(i.code);
  }
  for (const s of sections) if (!set.items.some((i) => i.section === s)) throw new BadRequestException(`${label}: nhóm ${s} chưa có mục nào`);
  const total = round2(set.items.reduce((sum, i) => sum + i.max, 0));
  if (total !== MAX_GENERAL_SCORE) throw new BadRequestException(`${label}: tổng điểm các mục là ${total}, phải đúng ${MAX_GENERAL_SCORE}`);
  return {
    sections: set.sections.map((s) => ({ code: s.code, name: s.name.trim() })),
    items: set.items.map((i) => ({ code: i.code, section: i.section, name: i.name.trim(), max: i.max })),
  };
}

/**
 * Kiểm tra kết quả chấm: mỗi mục của bảng có đúng một dấu; Không đảm bảo phải ghi căn cứ. Nếu có `compareWith` (kết quả tự chấm
 * cùng phiên bản) thì mục chấm khác cũng phải ghi căn cứ (bộ tiêu chí mục 2.1.3).
 */
export function checkMarks(input: readonly { code: string; ok: boolean; note?: string | null }[] | undefined, set: GeneralCriteriaSet, who: string, compareWith?: readonly GeneralMark[] | null): GeneralMark[] {
  if (!input || input.length === 0) throw new BadRequestException(`${who} cần chấm từng mục tiêu chí chung (Đảm bảo hoặc Không đảm bảo)`);
  const byCode = new Map<string, { code: string; ok: boolean; note?: string | null }>();
  for (const m of input) {
    if (!set.items.some((i) => i.code === m.code)) throw new BadRequestException(`Mục ${m.code} không có trong bảng tiêu chí chung đang áp dụng`);
    if (byCode.has(m.code)) throw new BadRequestException(`Mục ${m.code} được chấm hai lần`);
    if (typeof m.ok !== 'boolean') throw new BadRequestException(`Mục ${m.code}: chọn Đảm bảo hoặc Không đảm bảo`);
    byCode.set(m.code, m);
  }
  const missing = set.items.filter((i) => !byCode.has(i.code)).map((i) => i.code);
  if (missing.length > 0) throw new BadRequestException(`Chưa chấm các mục: ${missing.join(', ')}`);
  const self = new Map((compareWith ?? []).map((m) => [m.code, m]));
  return set.items.map((item) => {
    const m = byCode.get(item.code)!;
    const note = m.note?.trim() || null;
    if (note && note.length > MAX_NOTE) throw new BadRequestException(`Căn cứ của mục ${item.code} dài quá ${MAX_NOTE} ký tự`);
    if (!m.ok && !note) throw new BadRequestException(`Mục ${item.code} Không đảm bảo: cần ghi căn cứ (hạn chế, vi phạm cụ thể)`);
    const own = self.get(item.code);
    // Chấm khác tự chấm thì phải có căn cứ của chính người chấm, không giữ nguyên câu căn cứ của người tự chấm.
    if (own && own.ok !== m.ok && (!note || note === own.note)) throw new BadRequestException(`Mục ${item.code} chấm khác kết quả tự chấm: cần ghi căn cứ riêng của người chấm`);
    return { code: item.code, ok: m.ok, note };
  });
}

/** Điểm tiêu chí chung: tổng điểm tối đa các mục Đảm bảo. */
export function scoreOf(marks: readonly GeneralMark[], set: GeneralCriteriaSet): number {
  const max = new Map(set.items.map((i) => [i.code, i.max]));
  return round2(marks.reduce((sum, m) => sum + (m.ok ? (max.get(m.code) ?? 0) : 0), 0));
}

const leaderItem = (code: string, name: string, max: number): GeneralItem => ({ code, section: code.split('.')[0], name, max });

/** 05-HD/TU Phụ lục 03, Mẫu 5, phần A: nhóm tiêu chí chung (30 điểm) đối với cán bộ lãnh đạo, quản lý. */
export const LEADER_SET: GeneralCriteriaSet = {
  sections: [
    { code: '1', name: 'Về phẩm chất chính trị, đạo đức, lối sống, thực hiện trách nhiệm nêu gương' },
    { code: '2', name: 'Tư duy đổi mới, chiến lược, khát vọng cống hiến, dám nghĩ, dám làm' },
    { code: '3', name: 'Về tự phê bình và phê bình, tự soi, tự sửa, khắc phục hạn chế, khuyết điểm' },
  ],
  items: [
    leaderItem('1.1', 'Tuyệt đối trung thành với Đảng, Tổ quốc và Nhân dân; kiên định chủ nghĩa Mác - Lênin, tư tưởng Hồ Chí Minh, mục tiêu độc lập dân tộc và chủ nghĩa xã hội; lập trường, quan điểm, bản lĩnh chính trị vững vàng; kiên quyết bảo vệ nền tảng tư tưởng, Cương lĩnh, đường lối của Đảng, Hiến pháp, pháp luật; đấu tranh phản bác các quan điểm sai trái, thù địch, biểu hiện suy thoái, "tự diễn biến", "tự chuyển hóa"', 2),
    leaderItem('1.2', 'Yêu nước sâu sắc, tận tụy phục vụ Nhân dân, sâu sát cơ sở, luôn hành động vì lợi ích của Nhân dân; đặt lợi ích của Đảng, quốc gia - dân tộc, Nhân dân, tập thể lên trên lợi ích cá nhân', 2),
    leaderItem('1.3', 'Chấp hành nghiêm chủ trương, đường lối, nghị quyết, chỉ thị, quy định, nguyên tắc tổ chức, kỷ luật của Đảng, nhất là nguyên tắc tập trung dân chủ, tự phê bình và phê bình; chấp hành nghiêm pháp luật và quy định của cơ quan, đơn vị; tuyệt đối chấp hành sự phân công của tổ chức', 2),
    leaderItem('1.4', 'Tự giác, trách nhiệm cao trong nghiên cứu, học tập chủ nghĩa Mác - Lênin, tư tưởng Hồ Chí Minh, nghị quyết, chỉ thị của Đảng và các chương trình bồi dưỡng, cập nhật kiến thức mới', 2),
    leaderItem('1.5', 'Phẩm chất đạo đức, lối sống trong sáng, trung thực, khiêm tốn, cần, kiệm, liêm, chính, chí công vô tư; chấp hành chuẩn mực đạo đức cách mạng, trách nhiệm nêu gương; không vi phạm những điều đảng viên không được làm; không né tránh công việc, chạy theo thành tích; không vi phạm đạo đức, lối sống đến mức bị xử lý kỷ luật', 2),
    leaderItem('1.6', 'Không tham vọng quyền lực, chạy chức, chạy quyền; không tham nhũng, lãng phí, cơ hội, vụ lợi, cục bộ, lợi ích nhóm; không để gia đình, người thân lợi dụng chức vụ để trục lợi; không có biểu hiện suy thoái, "tự diễn biến", "tự chuyển hóa"; kiên quyết đấu tranh chống quan liêu, tham nhũng, lãng phí, tiêu cực', 2),
    leaderItem('1.7', 'Có uy tín cao, tiêu biểu về phẩm chất đạo đức và phong cách công tác; là trung tâm đoàn kết, thương yêu đồng chí, đồng nghiệp', 2),
    leaderItem('1.8', 'Có tinh thần chủ động, đổi mới sáng tạo; phấn đấu vì mục tiêu phát triển của cơ quan, đơn vị, đóng góp vào mục tiêu chung', 2),
    leaderItem('1.9', 'Thực hiện kê khai và công khai tài sản, thu nhập theo quy định; báo cáo đầy đủ, trung thực, cung cấp thông tin chính xác, khách quan với cấp trên khi được yêu cầu', 2),
    leaderItem('2.1', 'Có tư duy đổi mới, tầm nhìn chiến lược, khả năng lãnh đạo, chỉ đạo thích ứng; phương pháp làm việc khoa học, nhạy bén chính trị; có năng lực cụ thể hóa trong lãnh đạo, chỉ đạo cơ quan, đơn vị hoàn thành tốt chức năng, nhiệm vụ', 1),
    leaderItem('2.2', 'Bám sát thực tiễn, có nhiều cách làm hay, sáng tạo, đạt hiệu quả cao trong lãnh đạo, chỉ đạo, tổ chức thực hiện nhiệm vụ; xây dựng tổ chức đảng, cơ quan, đơn vị vững mạnh', 1),
    leaderItem('2.3', 'Nói đi đôi với làm; dám nghĩ, dám làm, dám chịu trách nhiệm, dám đột phá vì lợi ích chung; phân tích, dự báo tình hình; đề xuất hoặc quyết định giải pháp phù hợp, kịp thời, hiệu quả', 1),
    leaderItem('2.4', 'Có khát vọng phấn đấu, cống hiến; quy tụ và phát huy sức mạnh của tập thể, cá nhân trong cơ quan, đơn vị và các cơ quan, đơn vị liên quan', 1),
    leaderItem('3.1', 'Chủ động, nghiêm túc tự phê bình và phê bình; có tinh thần cầu thị, tiếp thu phản biện, góp ý', 2),
    leaderItem('3.2', 'Có kế hoạch rõ ràng và quyết liệt trong khắc phục hạn chế, khuyết điểm đã được chỉ ra', 2),
    leaderItem('3.3', 'Kết quả khắc phục hoàn thành từ 80% nội dung trở lên, có tiến bộ rõ, được tổ chức đánh giá tốt; không để tái diễn tồn tại', 2),
    leaderItem('3.4', 'Tự soi, tự sửa trên tinh thần trách nhiệm chính trị cao, không né tránh, không đổ lỗi', 2),
  ],
};

const staffItem = (code: string, name: string, max: number): GeneralItem => ({ code, section: code.split('.')[0], name, max });

/** Nghị định 335 Phụ lục II, Mẫu số 01, phần I (nội dung chi tiết ở Phụ lục I): tiêu chí chung đối với công chức. */
export const STAFF_SET: GeneralCriteriaSet = {
  sections: [
    { code: 'I', name: 'Phẩm chất chính trị, phẩm chất đạo đức, văn hóa thực thi công vụ và ý thức kỷ luật, kỷ cương trong thực thi công vụ' },
    { code: 'II', name: 'Năng lực chuyên môn, nghiệp vụ; khả năng đáp ứng yêu cầu thực thi nhiệm vụ được giao; tinh thần trách nhiệm; thái độ phục vụ và khả năng phối hợp với đồng nghiệp' },
    { code: 'III', name: 'Năng lực đổi mới, sáng tạo, dám nghĩ, dám làm, dám chịu trách nhiệm vì lợi ích chung trong thực thi công vụ' },
  ],
  items: [
    staffItem('I.1', 'Phẩm chất chính trị, phẩm chất đạo đức, văn hóa thực thi công vụ (chấp hành đường lối, nguyên tắc tổ chức, kỷ luật của Đảng; bản lĩnh chính trị; học tập lý luận; đạo đức, lối sống, không suy thoái, tham nhũng, vụ lợi; đoàn kết; thái độ, phong cách chuẩn mực; tự phê bình, khắc phục khuyết điểm đã được chỉ ra)', 5),
    staffItem('I.2', 'Ý thức kỷ luật, kỷ cương trong thực thi công vụ (chấp hành sự phân công; quy định, quy chế, nội quy; kê khai tài sản, thu nhập; báo cáo trung thực với cấp trên)', 5),
    staffItem('II.1', 'Năng lực chuyên môn, nghiệp vụ theo yêu cầu của vị trí việc làm', 2.5),
    staffItem('II.2', 'Khả năng đáp ứng yêu cầu thực thi nhiệm vụ được giao thường xuyên, đột xuất', 2.5),
    staffItem('II.3', 'Tinh thần trách nhiệm trong thực thi công vụ', 2.5),
    staffItem('II.4', 'Thái độ phục vụ người dân, doanh nghiệp và khả năng phối hợp với đồng nghiệp', 2.5),
    staffItem('III.1', 'Có sản phẩm, giải pháp đột phá, sáng tạo đem lại giá trị, hiệu quả thiết thực, tác động tích cực đến kết quả thực hiện nhiệm vụ của cơ quan, đơn vị', 2.5),
    staffItem('III.2', 'Sẵn sàng tham gia thực hiện nhiệm vụ chính trị đặc biệt quan trọng, nhiệm vụ có tính chất đột xuất, phức tạp hoặc trong điều kiện khó khăn', 2.5),
    staffItem('III.3', 'Có tinh thần chịu trách nhiệm trước kết quả công việc; chủ động nhận trách nhiệm khi có sai sót và có biện pháp khắc phục rõ ràng, cụ thể', 2.5),
    staffItem('III.4', 'Chủ động đưa ra quyết định trong phạm vi thẩm quyền, không né tránh; có tinh thần tiên phong trong thực hiện những nhiệm vụ mới', 2.5),
  ],
};

export const DEFAULT_CRITERIA_NOTE = 'Lãnh đạo, quản lý: 05-HD/TU Phụ lục 03 (Mẫu 5, phần A). Công chức: Nghị định 335/2025/NĐ-CP Phụ lục II, Mẫu số 01.';
