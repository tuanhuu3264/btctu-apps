import { describe, expect, it } from 'vitest';
import { LEADER as SEED_LEADER, STAFF as SEED_STAFF } from '../../../database/migrations/1763400000000-GeneralCriteria.js';
import { checkMarks, effectiveVersion, LEADER_SET, scoreOf, STAFF_SET, validateSet } from './general-criteria.js';
import type { GeneralCriteriaVersion } from './general-criteria.js';

describe('Bảng tiêu chí chung theo văn bản', () => {
  it('lãnh đạo theo 05-HD/TU Phụ lục 03: nhóm 1 = 18, nhóm 2 = 4, nhóm 3 = 8, 17 mục', () => {
    const sum = (s: string) => LEADER_SET.items.filter((i) => i.section === s).reduce((a, i) => a + i.max, 0);
    expect([sum('1'), sum('2'), sum('3')]).toEqual([18, 4, 8]);
    expect(LEADER_SET.items).toHaveLength(17);
    expect(validateSet(LEADER_SET, 'x')).toEqual(LEADER_SET);
  });

  it('công chức theo Nghị định 335 Mẫu số 01: I = 5 + 5, II và III = 4 × 2,5', () => {
    expect(STAFF_SET.items.map((i) => i.max)).toEqual([5, 5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5]);
    expect(validateSet(STAFF_SET, 'x')).toEqual(STAFF_SET);
  });

  it('migration gieo đúng hai bảng trong mã', () => {
    expect(SEED_LEADER).toEqual(LEADER_SET);
    expect(SEED_STAFF).toEqual(STAFF_SET);
  });
});

describe('validateSet', () => {
  const base = () => structuredClone(STAFF_SET);

  it('tổng khác 30 thì từ chối', () => {
    const s = base();
    s.items[0].max = 4;
    expect(() => validateSet(s, 'Bảng')).toThrow(/tổng điểm các mục là 29/);
  });

  it('mục thuộc nhóm không có, mã trùng, điểm lẻ hơn 0,5 đều bị từ chối', () => {
    const a = base();
    a.items[0].section = 'IV';
    expect(() => validateSet(a, 'Bảng')).toThrow(/nhóm "IV"/);
    const b = base();
    b.items[1].code = 'I.1';
    expect(() => validateSet(b, 'Bảng')).toThrow(/bị trùng/);
    const c = base();
    c.items[0].max = 4.75;
    c.items[1].max = 5.25;
    expect(() => validateSet(c, 'Bảng')).toThrow(/bội số của 0,5/);
  });

  it('nhóm không có mục nào thì từ chối', () => {
    const s = base();
    s.sections.push({ code: 'IV', name: 'Nhóm thừa' });
    expect(() => validateSet(s, 'Bảng')).toThrow(/nhóm IV chưa có mục/);
  });
});

describe('checkMarks và scoreOf', () => {
  const all = (failed: string[] = []) => STAFF_SET.items.map((i) => ({ code: i.code, ok: !failed.includes(i.code), note: failed.includes(i.code) ? 'Đi muộn 3 lần' : null }));

  it('đủ mục, Không đảm bảo có căn cứ: điểm là tổng các mục Đảm bảo', () => {
    const marks = checkMarks(all(['I.2', 'III.1']), STAFF_SET, 'Cá nhân');
    expect(scoreOf(marks, STAFF_SET)).toBe(22.5);
    expect(marks.find((m) => m.code === 'I.2')).toEqual({ code: 'I.2', ok: false, note: 'Đi muộn 3 lần' });
  });

  it('thiếu mục, mục lạ, chấm hai lần, Không đảm bảo không căn cứ đều bị từ chối', () => {
    expect(() => checkMarks(all().slice(1), STAFF_SET, 'Cá nhân')).toThrow(/Chưa chấm các mục: I.1/);
    expect(() => checkMarks([...all(), { code: '9.9', ok: true }], STAFF_SET, 'Cá nhân')).toThrow(/9.9 không có/);
    expect(() => checkMarks([...all(), { code: 'I.1', ok: true }], STAFF_SET, 'Cá nhân')).toThrow(/hai lần/);
    expect(() => checkMarks(all().map((m) => (m.code === 'II.1' ? { ...m, ok: false, note: '  ' } : m)), STAFF_SET, 'Cá nhân')).toThrow(/II.1 Không đảm bảo: cần ghi căn cứ/);
    expect(() => checkMarks(undefined, STAFF_SET, 'Người thẩm định')).toThrow(/Người thẩm định cần chấm từng mục/);
  });

  it('người thẩm định chấm khác kết quả tự chấm phải ghi căn cứ, kể cả khi nâng lên Đảm bảo', () => {
    const self = checkMarks(all(['III.1']), STAFF_SET, 'Cá nhân');
    expect(() => checkMarks(all(), STAFF_SET, 'Người thẩm định', self)).toThrow(/III.1 chấm khác kết quả tự chấm/);
    const ok = checkMarks(all().map((m) => (m.code === 'III.1' ? { ...m, note: 'Có sáng kiến số hóa hồ sơ' } : m)), STAFF_SET, 'Người thẩm định', self);
    expect(scoreOf(ok, STAFF_SET)).toBe(30);
  });
});

describe('effectiveVersion', () => {
  const v = (id: string, effectiveFrom: string) => ({ id, effectiveFrom }) as GeneralCriteriaVersion;
  const versions = [v('a', '2026-11-01'), v('b', '2027-03-01')];

  it('chọn phiên bản gần nhất không sau ngày bắt đầu kỳ; trước phiên bản đầu thì không có', () => {
    expect(effectiveVersion(versions, '2026-10-01')).toBeNull();
    expect(effectiveVersion(versions, '2026-11-01')?.id).toBe('a');
    expect(effectiveVersion(versions, '2027-01-01')?.id).toBe('a');
    expect(effectiveVersion(versions, '2027-04-01')?.id).toBe('b');
  });
});
