import { addDaysIso, firstOccurrenceOnOrAfter, nextOccurrence, occurrencesUpTo } from './recurring.model.js';

describe('lần lặp của việc định kỳ', () => {
  it('thêm ngày qua ranh giới tháng, năm và năm nhuận', () => {
    expect(addDaysIso('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-10-05', 0)).toBe('2026-10-05');
  });

  it('hằng tuần: thứ Hai trở đi, đúng thứ Hai thì giữ nguyên', () => {
    expect(firstOccurrenceOnOrAfter('WEEKLY', '2026-10-05')).toBe('2026-10-05'); // thứ Hai
    expect(firstOccurrenceOnOrAfter('WEEKLY', '2026-10-06')).toBe('2026-10-12');
    expect(firstOccurrenceOnOrAfter('WEEKLY', '2026-10-11')).toBe('2026-10-12'); // Chủ nhật
    expect(nextOccurrence('WEEKLY', '2026-12-28')).toBe('2027-01-04');
  });

  it('hằng tháng: ngày 1 của tháng này nếu đang ngày 1, không thì tháng sau; qua năm', () => {
    expect(firstOccurrenceOnOrAfter('MONTHLY', '2026-10-01')).toBe('2026-10-01');
    expect(firstOccurrenceOnOrAfter('MONTHLY', '2026-10-02')).toBe('2026-11-01');
    expect(firstOccurrenceOnOrAfter('MONTHLY', '2026-12-15')).toBe('2027-01-01');
    expect(nextOccurrence('MONTHLY', '2026-12-01')).toBe('2027-01-01');
  });

  it('hằng quý: đầu quý (1/1, 1/4, 1/7, 1/10)', () => {
    expect(firstOccurrenceOnOrAfter('QUARTERLY', '2026-10-01')).toBe('2026-10-01');
    expect(firstOccurrenceOnOrAfter('QUARTERLY', '2026-10-02')).toBe('2027-01-01');
    expect(firstOccurrenceOnOrAfter('QUARTERLY', '2026-05-20')).toBe('2026-07-01');
    expect(firstOccurrenceOnOrAfter('QUARTERLY', '2026-02-01')).toBe('2026-04-01');
    expect(nextOccurrence('QUARTERLY', '2026-10-01')).toBe('2027-01-01');
    expect(nextOccurrence('QUARTERLY', '2026-01-01')).toBe('2026-04-01');
  });

  it('hằng năm: 1/1', () => {
    expect(firstOccurrenceOnOrAfter('YEARLY', '2027-01-01')).toBe('2027-01-01');
    expect(firstOccurrenceOnOrAfter('YEARLY', '2026-03-01')).toBe('2027-01-01');
    expect(nextOccurrence('YEARLY', '2027-01-01')).toBe('2028-01-01');
  });

  describe('occurrencesUpTo', () => {
    it('từ ngày bắt đầu đến hôm nay, không quá hôm nay, theo thứ tự thời gian', () => {
      const t = { frequency: 'MONTHLY' as const, startDate: '2026-07-15', endDate: null };
      expect(occurrencesUpTo(t, '2026-10-05')).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
      expect(occurrencesUpTo(t, '2026-07-31')).toEqual([]); // chưa đến lần đầu
      expect(occurrencesUpTo(t, '2026-08-01')).toEqual(['2026-08-01']); // đúng ngày thì sinh
    });

    it('dừng ở ngày kết thúc (gồm cả ngày đó)', () => {
      const t = { frequency: 'MONTHLY' as const, startDate: '2026-01-01', endDate: '2026-03-01' };
      expect(occurrencesUpTo(t, '2026-12-31')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    });

    it('giới hạn số lần mỗi lượt để không bùng nổ; lượt sau sinh phần còn lại', () => {
      const t = { frequency: 'WEEKLY' as const, startDate: '2020-01-01', endDate: null };
      expect(occurrencesUpTo(t, '2026-10-05', 3)).toHaveLength(3);
      expect(occurrencesUpTo(t, '2026-10-05', 3)[0]).toBe('2020-01-06');
    });

    it('hằng tuần qua nhiều tuần liên tiếp', () => {
      const t = { frequency: 'WEEKLY' as const, startDate: '2026-10-01', endDate: null };
      expect(occurrencesUpTo(t, '2026-10-20')).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
    });
  });
});
