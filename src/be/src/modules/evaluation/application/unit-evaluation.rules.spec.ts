import type { PeriodWork } from './evaluation.ports.js';
import { computeMetrics, headRatingWarning, quotaWarning, ratingWarnings } from './unit-evaluation.rules.js';

const work = (planned: number, confirmed: number, late = 0): PeriodWork => ({
  assignmentId: `a${planned}${confirmed}${late}`,
  taskTitle: 't',
  personId: 'p',
  catalogItemCode: 'B.009',
  plannedQuantity: planned,
  confirmedQuantity: confirmed,
  lateCount: late,
  reworkCount: 0,
  evidence: null,
});

describe('số liệu tham chiếu của tập thể', () => {
  it('đếm việc hoàn thành, đúng hạn, vượt mức và chậm', () => {
    const m = computeMetrics([work(10, 10), work(10, 12), work(5, 5, 1), work(4, 1), work(3, 3, 2)]);
    expect(m).toEqual({ works: 5, completed: 4, onTime: 2, exceeded: 1, late: 2 });
  });

  it('không có việc nào thì mọi số đều 0', () => {
    expect(computeMetrics([])).toEqual({ works: 0, completed: 0, onTime: 0, exceeded: 0, late: 0 });
  });
});

describe('cảnh báo điều kiện xếp loại (Nghị định 335 Điều 8)', () => {
  const full = { works: 10, completed: 10, onTime: 10, exceeded: 3, late: 0 };

  it('xuất sắc đủ điều kiện chỉ còn lời nhắc xác nhận khắc phục hạn chế kỳ trước', () => {
    const w = ratingWarnings('XUAT_SAC', full, []);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/khắc phục hạn chế/);
  });

  it('xuất sắc thiếu đúng hạn, thiếu vượt mức, có cấp dưới không hoàn thành', () => {
    const w = ratingWarnings('XUAT_SAC', { works: 10, completed: 9, onTime: 8, exceeded: 2, late: 1 }, ['Phòng A']);
    expect(w.join('|')).toMatch(/100% nhiệm vụ hoàn thành đúng hạn \(8\/10/);
    expect(w.join('|')).toMatch(/30% nhiệm vụ vượt mức, hiện 2\/10/);
    expect(w.join('|')).toMatch(/Phòng A/);
  });

  it('tốt chỉ đòi đúng hạn, không đòi vượt mức', () => {
    expect(ratingWarnings('HOAN_THANH_TOT', full, [])).toEqual([]);
    expect(ratingWarnings('HOAN_THANH_TOT', { ...full, onTime: 9 }, [])).toHaveLength(1);
  });

  it('hoàn thành: đủ 100% việc và chậm không quá 20%', () => {
    expect(ratingWarnings('HOAN_THANH', { works: 10, completed: 10, onTime: 8, exceeded: 0, late: 2 }, [])).toEqual([]);
    const w = ratingWarnings('HOAN_THANH', { works: 10, completed: 9, onTime: 6, exceeded: 0, late: 3 }, []);
    expect(w).toHaveLength(2);
  });

  it('dưới 70% việc hoàn thành thì mọi mức trên không hoàn thành đều bị cảnh báo', () => {
    const low = { works: 10, completed: 6, onTime: 6, exceeded: 0, late: 0 };
    expect(ratingWarnings('HOAN_THANH', low, []).join('|')).toMatch(/dưới 70%/);
    expect(ratingWarnings('KHONG_HOAN_THANH', low, [])).toEqual([]);
  });

  it('chưa có việc nào thì nói rõ là chưa đối chiếu được', () => {
    expect(ratingWarnings('HOAN_THANH_TOT', { works: 0, completed: 0, onTime: 0, exceeded: 0, late: 0 }, [])[0]).toMatch(/chưa đối chiếu được/);
  });
});

describe('hạn mức xuất sắc', () => {
  it('không vượt 20% số đơn vị hoàn thành tốt thì không cảnh báo', () => {
    expect(quotaWarning(['XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH_TOT', 'HOAN_THANH_TOT', 'HOAN_THANH_TOT', 'HOAN_THANH_TOT'])).toBeNull();
    expect(quotaWarning(['HOAN_THANH_TOT', 'HOAN_THANH'])).toBeNull();
  });

  it('vượt thì cảnh báo, kể cả khi chưa đơn vị nào hoàn thành tốt', () => {
    expect(quotaWarning(['XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH_TOT'])).toMatch(/vượt hạn mức 20%/);
    expect(quotaWarning(['XUAT_SAC'])).toMatch(/1 đơn vị xuất sắc trên 0/);
  });
});

describe('mức người đứng đầu so với tổ chức (Điều 20.6)', () => {
  const unit = (rating: 'XUAT_SAC' | 'HOAN_THANH_TOT' | 'HOAN_THANH' | 'KHONG_HOAN_THANH', approved = true) => ({ unitName: 'Phòng A', rating, approved });

  it('bằng hoặc thấp hơn mức tổ chức thì không cảnh báo', () => {
    expect(headRatingWarning('HOAN_THANH_TOT', unit('HOAN_THANH_TOT'))).toBeNull();
    expect(headRatingWarning('HOAN_THANH', unit('XUAT_SAC'))).toBeNull();
    expect(headRatingWarning('KHONG_HOAN_THANH', unit('KHONG_HOAN_THANH'))).toBeNull();
  });

  it('cao hơn mức tổ chức thì cảnh báo, kể cả chỉ hơn một bậc', () => {
    expect(headRatingWarning('HOAN_THANH', unit('KHONG_HOAN_THANH'))).toMatch(/hoàn thành nhiệm vụ, cao hơn mức của Phòng A: không hoàn thành nhiệm vụ/);
    expect(headRatingWarning('XUAT_SAC', unit('HOAN_THANH_TOT', false))).toMatch(/chưa được công nhận/);
  });
});
