import { BadRequestException } from '@nestjs/common';
import { DEFAULT_AXES, GENERAL_AXES, UNIT_AXIS_PRESETS, resolveScores, suggestedScores, validateAxisConfig } from './unit-axes.js';
import type { AxisDefinition } from './unit-axes.js';
import { FIXTURE_AXES } from './testing/axes-fixture.js';

const axisScores = (value: (a: AxisDefinition) => number) => FIXTURE_AXES.map((a) => ({ code: a.code, score: value(a) }));
const sum = (defs: readonly AxisDefinition[], kind: AxisDefinition['kind']) => defs.filter((a) => a.kind === kind).reduce((s, a) => s + a.maxPoints, 0);

describe('bộ trục của bộ tiêu chí (Quy định 366-QĐ/TW Phụ lục 1, ADR-052)', () => {
  it('bộ mặc định và bộ của 4 phòng đều hợp lệ: chung 30, kết quả 70', () => {
    for (const [name, defs] of [['mặc định', DEFAULT_AXES], ...Object.entries(UNIT_AXIS_PRESETS)] as const) {
      expect([name, validateAxisConfig(defs)]).toEqual([name, []]);
      expect(sum(defs, 'GENERAL')).toBe(30);
      expect(sum(defs, 'RESULT')).toBe(70);
    }
    expect(Object.keys(UNIT_AXIS_PRESETS).sort()).toEqual(['BVCTNB', 'TCCB', 'TCDDV', 'VP']);
  });

  it('mọi bộ dùng chung sáu tiêu chí chung và phần chung KH 15, CS 5, DN 10; chỉ KH có gợi ý tự động', () => {
    expect(GENERAL_AXES.map((a) => [a.code, a.maxPoints])).toEqual([['C1', 5], ['C2', 5], ['C3', 5], ['C4', 5], ['C5', 5], ['C6', 5]]);
    for (const defs of [DEFAULT_AXES, ...Object.values(UNIT_AXIS_PRESETS)]) {
      expect(defs.filter((a) => a.kind === 'GENERAL').map((a) => a.code)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']);
      expect(defs.filter((a) => ['KH', 'CS', 'DN'].includes(a.code)).map((a) => a.maxPoints)).toEqual([15, 5, 10]);
      expect(defs.filter((a) => a.autoMetric).map((a) => a.code)).toEqual(['KH']);
      // phần đặc thù 40 điểm: trục chính không nhẹ hơn trục phụ (05-HD/TU mục IV.1.2)
      const special = defs.filter((a) => a.kind === 'RESULT' && !['KH', 'CS', 'DN'].includes(a.code)).map((a) => a.maxPoints);
      expect(special.reduce((s, n) => s + n, 0)).toBe(40);
      expect([...special].sort((a, b) => b - a)).toEqual(special);
    }
  });
});

describe('kiểm tra cấu hình trục', () => {
  const change = (code: string, patch: Partial<AxisDefinition>) => FIXTURE_AXES.map((a) => (a.code === code ? { ...a, ...patch } : a));

  it('tổng nhóm kết quả khác 70 bị từ chối, nêu số hiện có', () => {
    expect(validateAxisConfig(change('T6', { maxPoints: 6 })).join('|')).toMatch(/kết quả nhiệm vụ đang bật là 71, phải bằng 70/);
    expect(validateAxisConfig(change('G1', { maxPoints: 9 })).join('|')).toMatch(/tiêu chí chung đang bật là 29, phải bằng 30/);
  });

  it('tắt một trục làm tổng lệch thì bị từ chối; tắt cả nhóm thì hợp lệ (nhập một số)', () => {
    expect(validateAxisConfig(change('T6', { active: false })).join('|')).toMatch(/đang bật là 65/);
    expect(validateAxisConfig(FIXTURE_AXES.map((a) => (a.kind === 'RESULT' ? { ...a, active: false } : a)))).toEqual([]);
  });

  it('mã trùng, mã sai dạng, tên ngắn, điểm không dương', () => {
    const bad = [...FIXTURE_AXES, { ...FIXTURE_AXES[0], code: 'T1' }, { ...FIXTURE_AXES[0], code: 'x-1', name: 'ab', maxPoints: 0 }];
    const e = validateAxisConfig(bad).join('|');
    expect(e).toMatch(/Mã trục T1 bị trùng/);
    expect(e).toMatch(/Mã trục "x-1"/);
    expect(e).toMatch(/tên ít nhất 3 ký tự/);
    expect(e).toMatch(/điểm tối đa lớn hơn 0/);
  });
});

describe('điểm theo trục', () => {
  it('điểm chung và điểm kết quả là tổng các trục cùng loại, kèm ảnh chụp định nghĩa', () => {
    const r = resolveScores(FIXTURE_AXES, { axes: axisScores((a) => a.maxPoints * 0.8) });
    expect(r.generalScore).toBe(24);
    expect(r.resultScore).toBe(56);
    expect(r.axes).toHaveLength(9);
    expect(r.axes![4]).toEqual({ code: 'T2', name: expect.stringContaining('Hoàn thành chương trình'), kind: 'RESULT', max: 20, score: 16 });
  });

  it('thiếu trục, trục vượt tối đa, âm, chấm hai lần hoặc mã lạ đều bị từ chối', () => {
    const full = axisScores((a) => a.maxPoints);
    expect(() => resolveScores(FIXTURE_AXES, { axes: full.slice(1) })).toThrow(/Thiếu điểm trục G1/);
    expect(() => resolveScores(FIXTURE_AXES, { axes: full.map((a) => (a.code === 'T1' ? { ...a, score: 15.5 } : a)) })).toThrow(/trục T1 phải từ 0 đến 15/);
    expect(() => resolveScores(FIXTURE_AXES, { axes: full.map((a) => (a.code === 'T1' ? { ...a, score: -1 } : a)) })).toThrow(BadRequestException);
    expect(() => resolveScores(FIXTURE_AXES, { axes: [...full, { code: 'T1', score: 1 }] })).toThrow(/chấm hai lần/);
    expect(() => resolveScores(FIXTURE_AXES, { axes: [...full, { code: 'X9', score: 1 }] })).toThrow(/không có hoặc đã tắt/);
  });

  it('trục đã tắt không được chấm', () => {
    const defs = FIXTURE_AXES.map((a) => (a.kind === 'RESULT' ? { ...a, active: false } : a));
    expect(() => resolveScores(defs, { resultScore: 50, axes: axisScores((a) => a.maxPoints) })).toThrow(/Trục T1 không có hoặc đã tắt/);
    const ok = resolveScores(defs, { resultScore: 50, axes: axisScores((a) => a.maxPoints).filter((a) => a.code.startsWith('G')) });
    expect(ok).toMatchObject({ generalScore: 30, resultScore: 50 });
    expect(ok.axes).toHaveLength(3);
  });

  it('không có trục nào đang bật thì nhập hai số như cũ, kiểm tra khoảng 0 đến 30 và 0 đến 70', () => {
    const none = FIXTURE_AXES.map((a) => ({ ...a, active: false }));
    expect(resolveScores(none, { generalScore: 25, resultScore: 60 })).toEqual({ generalScore: 25, resultScore: 60, axes: null });
    expect(() => resolveScores(none, { generalScore: 31, resultScore: 60 })).toThrow(/từ 0 đến 30/);
    expect(() => resolveScores(none, { generalScore: 25, resultScore: 71 })).toThrow(/từ 0 đến 70/);
    expect(() => resolveScores(none, { generalScore: 25 })).toThrow(/từ 0 đến 70/);
  });
});

describe('gợi ý tự động', () => {
  it('T2 gợi ý điểm tối đa nhân tỷ lệ việc hoàn thành; trục khác và chưa có việc thì không gợi ý', () => {
    expect(suggestedScores(FIXTURE_AXES, { works: 8, completed: 6, onTime: 5, exceeded: 1, late: 1 })).toEqual({ T2: 15 });
    expect(suggestedScores(FIXTURE_AXES, { works: 0, completed: 0, onTime: 0, exceeded: 0, late: 0 })).toEqual({});
    expect(suggestedScores(FIXTURE_AXES.map((a) => ({ ...a, active: false })), { works: 4, completed: 4, onTime: 4, exceeded: 0, late: 0 })).toEqual({});
  });
});
