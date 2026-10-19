import { BadRequestException } from '@nestjs/common';
import type { GeneralGroup } from './general-criteria.js';

/**
 * Sự kiện ảnh hưởng xếp loại cá nhân (ADR-055): kỷ luật, kết luận suy thoái, kết quả lấy phiếu tín nhiệm thấp, tham nhũng trong
 * phạm vi quản lý. Văn phòng ghi nhận; hệ thống dùng để buộc Không đảm bảo các mục tiêu chí chung liên quan trong kỳ có sự kiện
 * (bộ tiêu chí mục 2.1.4) và để xét điều kiện "Không hoàn thành nhiệm vụ" của năm (39-QĐ/TU Điều 11 mục 4; NĐ 335 Điều 11.3).
 */
export type RatingEventKind = 'KY_LUAT' | 'SUY_THOAI' | 'TIN_NHIEM_THAP' | 'THAM_NHUNG_PHAM_VI';
export const RATING_EVENT_KINDS: readonly RatingEventKind[] = ['KY_LUAT', 'SUY_THOAI', 'TIN_NHIEM_THAP', 'THAM_NHUNG_PHAM_VI'];
export const RATING_EVENT_LABELS: Record<RatingEventKind, string> = {
  KY_LUAT: 'Bị xử lý kỷ luật (từ khiển trách trở lên)',
  SUY_THOAI: 'Bị kết luận có biểu hiện suy thoái về tư tưởng chính trị, đạo đức, lối sống',
  TIN_NHIEM_THAP: 'Có trên 50% phiếu tín nhiệm thấp tại kỳ lấy phiếu',
  THAM_NHUNG_PHAM_VI: 'Trong phạm vi quản lý trực tiếp xảy ra tham nhũng, lãng phí, tiêu cực và bị xử lý kỷ luật',
};
/** Sự kiện chỉ áp dụng cho người giữ chức vụ lãnh đạo, quản lý (39-QĐ/TU mục 4.2 b, đ). */
export const LEADER_ONLY_KINDS: readonly RatingEventKind[] = ['TIN_NHIEM_THAP', 'THAM_NHUNG_PHAM_VI'];

/** Hình thức kỷ luật; mọi hình thức đều từ khiển trách trở lên. */
export type DisciplineForm = 'KHIEN_TRACH' | 'CANH_CAO' | 'HA_BAC_LUONG' | 'GIANG_CHUC' | 'CACH_CHUC' | 'BUOC_THOI_VIEC' | 'KHAI_TRU';
export const DISCIPLINE_FORMS: readonly DisciplineForm[] = ['KHIEN_TRACH', 'CANH_CAO', 'HA_BAC_LUONG', 'GIANG_CHUC', 'CACH_CHUC', 'BUOC_THOI_VIEC', 'KHAI_TRU'];
export type DisciplineSystem = 'DANG' | 'HANH_CHINH';
/**
 * Vi phạm bị kỷ luật: liên quan đến chức trách, công vụ; do suy thoái; hay lý do khác. Chỉ hai loại đầu là điều kiện "Không hoàn
 * thành nhiệm vụ" (NĐ 335 Điều 11.3; 39-QĐ/TU mục 4.2 c, 4.3 a). Mọi loại vẫn làm các mục kỷ luật của tiêu chí chung Không đảm bảo.
 */
export type DisciplineReason = 'CONG_VU' | 'SUY_THOAI' | 'KHAC';

export interface RatingEventModel {
  id: string;
  personId: string;
  kind: RatingEventKind;
  /** Ngày quyết định, kết luận có hiệu lực (YYYY-MM-DD). */
  effectiveDate: string;
  /** Số, ký hiệu văn bản. */
  decisionNo: string;
  form: DisciplineForm | null;
  system: DisciplineSystem | null;
  reason: DisciplineReason | null;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
}
export type NewRatingEvent = Omit<RatingEventModel, 'id' | 'createdAt'>;

export abstract class RatingEventRepository {
  /** Sự kiện của cán bộ có ngày hiệu lực trong khoảng [from, to]. */
  abstract findByPerson(personId: string, from: string, to: string): Promise<RatingEventModel[]>;
  abstract findById(id: string): Promise<RatingEventModel | null>;
  abstract create(data: NewRatingEvent): Promise<RatingEventModel>;
  abstract delete(id: string): Promise<void>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Kiểm tra dữ liệu khi ghi nhận: kỷ luật cần hình thức, hệ thống và loại vi phạm; loại khác thì không có các trường đó. */
export function checkRatingEvent(input: {
  kind: RatingEventKind;
  effectiveDate: string;
  decisionNo: string;
  form?: DisciplineForm | null;
  system?: DisciplineSystem | null;
  reason?: DisciplineReason | null;
  note?: string | null;
}): Pick<RatingEventModel, 'kind' | 'effectiveDate' | 'decisionNo' | 'form' | 'system' | 'reason' | 'note'> {
  if (!RATING_EVENT_KINDS.includes(input.kind)) throw new BadRequestException('Loại sự kiện không hợp lệ');
  if (!DATE.test(input.effectiveDate ?? '') || Number.isNaN(Date.parse(input.effectiveDate))) throw new BadRequestException('Ngày hiệu lực có dạng YYYY-MM-DD');
  const decisionNo = input.decisionNo?.trim();
  if (!decisionNo) throw new BadRequestException('Cần số, ký hiệu quyết định hoặc văn bản kết luận');
  const discipline = input.kind === 'KY_LUAT';
  if (discipline) {
    if (!input.form || !DISCIPLINE_FORMS.includes(input.form)) throw new BadRequestException('Kỷ luật cần nêu hình thức');
    if (input.system !== 'DANG' && input.system !== 'HANH_CHINH') throw new BadRequestException('Kỷ luật cần nêu là kỷ luật đảng hay kỷ luật hành chính');
    if (input.reason !== 'CONG_VU' && input.reason !== 'SUY_THOAI' && input.reason !== 'KHAC') throw new BadRequestException('Kỷ luật cần nêu loại vi phạm');
  } else if (input.form || input.system || input.reason) {
    throw new BadRequestException('Hình thức, hệ thống, loại vi phạm chỉ dùng cho sự kiện kỷ luật');
  }
  return {
    kind: input.kind,
    effectiveDate: input.effectiveDate,
    decisionNo,
    form: discipline ? input.form! : null,
    system: discipline ? input.system! : null,
    reason: discipline ? input.reason! : null,
    note: input.note?.trim() || null,
  };
}

/**
 * Mục tiêu chí chung bắt buộc Không đảm bảo theo sự kiện (bộ tiêu chí mục 2.1.4, đề xuất), theo mã của bảng 05-HD/TU Phụ lục 03
 * và Nghị định 335 Mẫu số 01. Bảng đã sửa mã thì mục không còn mã đó được bỏ qua.
 */
const FORCED: Record<GeneralGroup, Record<RatingEventKind, string[]>> = {
  LEADER: { KY_LUAT: ['1.3', '1.5'], SUY_THOAI: ['1.1', '1.5', '1.6'], TIN_NHIEM_THAP: ['1.7'], THAM_NHUNG_PHAM_VI: ['1.6'] },
  STAFF: { KY_LUAT: ['I.1', 'I.2'], SUY_THOAI: ['I.1'], TIN_NHIEM_THAP: [], THAM_NHUNG_PHAM_VI: [] },
};

/** Mục bị buộc Không đảm bảo trong kỳ, kèm sự kiện gây ra. */
export function forcedItems(events: readonly RatingEventModel[], group: GeneralGroup): Map<string, RatingEventModel[]> {
  const out = new Map<string, RatingEventModel[]>();
  for (const e of events) for (const code of FORCED[group][e.kind]) out.set(code, [...(out.get(code) ?? []), e]);
  return out;
}

export const describeEvent = (e: RatingEventModel): string => `${RATING_EVENT_LABELS[e.kind]}, ${e.decisionNo} (hiệu lực ${e.effectiveDate.split('-').reverse().join('/')})`;

/** Một điều kiện "Không hoàn thành nhiệm vụ" của năm. */
export interface YearCondition {
  code: 'KY_LUAT' | 'SUY_THOAI' | 'TIN_NHIEM_THAP' | 'THAM_NHUNG_PHAM_VI' | 'DON_VI_DUOI_70' | 'NHIEM_VU_TREN_50';
  text: string;
  /** Căn cứ quy định. */
  basis: string;
}

/** Số liệu tự tính cho điều kiện năm; null khi không có số liệu (không xét điều kiện đó). */
export interface YearFigures {
  /** Lãnh đạo: tỷ lệ việc hoàn thành của đơn vị phụ trách. */
  unit: { unitName: string; works: number; completed: number } | null;
  /** Không giữ chức vụ: số việc trong năm và số việc chưa hoàn thành. */
  own: { works: number; unfinished: number } | null;
}

/**
 * Điều kiện xếp loại "Không hoàn thành nhiệm vụ" của năm (39-QĐ/TU Điều 11 mục 4.2, 4.3; NĐ 335 Điều 11.3, 20.4). Mặc định xếp
 * "Không hoàn thành"; cấp có thẩm quyền giữ mức khác khi có ngoại lệ văn bản cho phép, kèm căn cứ (ADR-055).
 */
export function yearConditions(group: GeneralGroup, events: readonly RatingEventModel[], figures: YearFigures): YearCondition[] {
  const out: YearCondition[] = [];
  const leader = group === 'LEADER';
  const list = (kind: RatingEventKind, filter: (e: RatingEventModel) => boolean = () => true) => events.filter((e) => e.kind === kind && filter(e)).map(describeEvent);

  const discipline = list('KY_LUAT', (e) => e.reason === 'CONG_VU' || e.reason === 'SUY_THOAI');
  if (discipline.length > 0) {
    out.push({ code: 'KY_LUAT', text: `Bị kỷ luật do vi phạm liên quan đến công vụ hoặc do suy thoái: ${discipline.join('; ')}`, basis: leader ? '39-QĐ/TU mục 4.2.c; NĐ 335 Điều 11.3' : '39-QĐ/TU mục 4.3.a; NĐ 335 Điều 11.3' });
  }
  const decline = list('SUY_THOAI');
  if (decline.length > 0) out.push({ code: 'SUY_THOAI', text: `Bị kết luận có biểu hiện suy thoái: ${decline.join('; ')}`, basis: leader ? '39-QĐ/TU mục 4.2.d; NĐ 335 Điều 20.4.b' : '39-QĐ/TU mục 4.3.a; NĐ 335 Điều 20.4.b' });
  if (leader) {
    const trust = list('TIN_NHIEM_THAP');
    if (trust.length > 0) out.push({ code: 'TIN_NHIEM_THAP', text: `Trên 50% phiếu tín nhiệm thấp: ${trust.join('; ')}`, basis: '39-QĐ/TU mục 4.2.b' });
    const graft = list('THAM_NHUNG_PHAM_VI');
    if (graft.length > 0) out.push({ code: 'THAM_NHUNG_PHAM_VI', text: `Trong phạm vi quản lý trực tiếp có tham nhũng, tiêu cực bị xử lý kỷ luật: ${graft.join('; ')}`, basis: '39-QĐ/TU mục 4.2.đ; NĐ 335 Điều 20.4.d' });
    const u = figures.unit;
    if (u && u.works > 0 && u.completed / u.works < 0.7) {
      out.push({ code: 'DON_VI_DUOI_70', text: `${u.unitName} hoàn thành ${u.completed}/${u.works} việc được giao trong năm (${pct(u.completed, u.works)}), dưới 70%`, basis: '39-QĐ/TU mục 4.2.a' });
    }
  } else {
    const o = figures.own;
    if (o && o.works > 0 && o.unfinished / o.works > 0.5) {
      out.push({ code: 'NHIEM_VU_TREN_50', text: `${o.unfinished}/${o.works} việc được giao trong năm chưa hoàn thành (${pct(o.unfinished, o.works)}), trên 50%`, basis: '39-QĐ/TU mục 4.3.b' });
    }
  }
  return out;
}

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 1000) / 10}%`;

/** Ngoại lệ văn bản cho phép cấp có thẩm quyền giữ mức xếp loại khác khi có điều kiện "Không hoàn thành nhiệm vụ". */
export type ConditionException = 'TU_GIAC_KHAC_PHUC' | 'DA_TINH_NAM_TRUOC' | 'VI_PHAM_DON_VI_CU' | 'BAT_KHA_KHANG' | 'KHONG_THE_BIET';
export const CONDITION_EXCEPTIONS: Record<ConditionException, string> = {
  TU_GIAC_KHAC_PHUC: 'Tự giác nhận lỗi, tự phát hiện vi phạm và đã khắc phục xong hậu quả (39-QĐ/TU mục 4.2, 4.3)',
  DA_TINH_NAM_TRUOC: 'Vi phạm đã được dùng làm căn cứ xếp loại ở năm trước, hoặc cùng một hành vi bị kỷ luật đảng và hành chính ở hai năm (NĐ 335 Điều 11.3; 39-QĐ/TU mục 5.6)',
  VI_PHAM_DON_VI_CU: 'Vi phạm xảy ra ở cơ quan, đơn vị cũ, tính vào kết quả của đơn vị cũ (39-QĐ/TU mục 5.7)',
  BAT_KHA_KHANG: 'Không hoàn thành nhiệm vụ, chỉ tiêu do lý do bất khả kháng (39-QĐ/TU mục 4.1, 4.2)',
  KHONG_THE_BIET: 'Không thể biết, hoặc đã áp dụng các biện pháp cần thiết để phòng ngừa, ngăn chặn hành vi tham nhũng, tiêu cực (39-QĐ/TU mục 4.2)',
};
