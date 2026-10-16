import { BadRequestException } from '@nestjs/common';
import { DEFAULT_AXES, resolveScores, suggestedScores, validateAxisConfig } from './unit-axes.js';
import type { AxisDefinition } from './unit-axes.js';

const axisScores = (value: (a: AxisDefinition) => number) => DEFAULT_AXES.map((a) => ({ code: a.code, score: value(a) }));

describe('cấu hình mặc định', () => {
  it('ba nhóm chung 10 + 10 + 10 và sáu trục kết quả 15 + 20 + 10 + 10 + 10 + 5 hợp lệ', () => {
    expect(validateAxisConfig(DEFAULT_AXES)).toEqual([]);
    expect(DEFAULT_AXES.filter((a) => a.kind === 'GENERAL').reduce((s, a) => s + a.maxPoints, 0)).toBe(30);
    expect(DEFAULT_AXES.filter((a) => a.kind === 'RESULT').reduce((s, a) => s + a.maxPoints, 0)).toBe(70);
  });
});

describe('kiểm tra cấu hình trục', () => {
  const change = (code: string, patch: Partial<AxisDefinition>) => DEFAULT_AXES.map((a) => (a.code === code ? { ...a, ...patch } : a));

  it('tổng nhóm kết quả khác 70 bị từ chối, nêu số hiện có', () => {
    expect(validateAxisConfig(change('T6', { maxPoints: 6 })).join('|')).toMatch(/kết quả nhiệm vụ đang bật là 71, phải bằng 70/);
    expect(validateAxisConfig(change('G1', { maxPoints: 9 })).join('|')).toMatch(/tiêu chí chung đang bật là 29, phải bằng 30/);
  });

  it('tắt một trục làm tổng lệch thì bị từ chối; tắt cả nhóm thì hợp lệ (nhập một số)', () => {
    expect(validateAxisConfig(change('T6', { active: false })).join('|')).toMatch(/đang bật là 65/);
    expect(validateAxisConfig(DEFAULT_AXES.map((a) => (a.kind === 'RESULT' ? { ...a, active: false } : a)))).toEqual([]);
  });

  it('mã trùng, mã sai dạng, tên ngắn, điểm không dương', () => {
    const bad = [...DEFAULT_AXES, { ...DEFAULT_AXES[0], code: 'T1' }, { ...DEFAULT_AXES[0], code: 'x-1', name: 'ab', maxPoints: 0 }];
    const e = validateAxisConfig(bad).join('|');
    expect(e).toMatch(/Mã trục T1 bị trùng/);
    expect(e).toMatch(/Mã trục "x-1"/);
    expect(e).toMatch(/tên ít nhất 3 ký tự/);
    expect(e).toMatch(/điểm tối đa lớn hơn 0/);
  });
});

describe('điểm theo trục', () => {
  it('điểm chung và điểm kết quả là tổng các trục cùng loại, kèm ảnh chụp định nghĩa', () => {
    const r = resolveScores(DEFAULT_AXES, { axes: axisScores((a) => a.maxPoints * 0.8) });
    expect(r.generalScore).toBe(24);
    expect(r.resultScore).toBe(56);
    expect(r.axes).toHaveLength(9);
    expect(r.axes![4]).toEqual({ code: 'T2', name: expect.stringContaining('Hoàn thành chương trình'), kind: 'RESULT', max: 20, score: 16 });
  });

  it('thiếu trục, trục vượt tối đa, âm, chấm hai lần hoặc mã lạ đều bị từ chối', () => {
    const full = axisScores((a) => a.maxPoints);
    expect(() => resolveScores(DEFAULT_AXES, { axes: full.slice(1) })).toThrow(/Thiếu điểm trục G1/);
    expect(() => resolveScores(DEFAULT_AXES, { axes: full.map((a) => (a.code === 'T1' ? { ...a, score: 15.5 } : a)) })).toThrow(/trục T1 phải từ 0 đến 15/);
    expect(() => resolveScores(DEFAULT_AXES, { axes: full.map((a) => (a.code === 'T1' ? { ...a, score: -1 } : a)) })).toThrow(BadRequestException);
    expect(() => resolveScores(DEFAULT_AXES, { axes: [...full, { code: 'T1', score: 1 }] })).toThrow(/chấm hai lần/);
    expect(() => resolveScores(DEFAULT_AXES, { axes: [...full, { code: 'X9', score: 1 }] })).toThrow(/không có hoặc đã tắt/);
  });

  it('trục đã tắt không được chấm', () => {
    const defs = DEFAULT_AXES.map((a) => (a.kind === 'RESULT' ? { ...a, active: false } : a));
    expect(() => resolveScores(defs, { resultScore: 50, axes: axisScores((a) => a.maxPoints) })).toThrow(/Trục T1 không có hoặc đã tắt/);
    const ok = resolveScores(defs, { resultScore: 50, axes: axisScores((a) => a.maxPoints).filter((a) => a.code.startsWith('G')) });
    expect(ok).toMatchObject({ generalScore: 30, resultScore: 50 });
    expect(ok.axes).toHaveLength(3);
  });

  it('không có trục nào đang bật thì nhập hai số như cũ, kiểm tra khoảng 0 đến 30 và 0 đến 70', () => {
    const none = DEFAULT_AXES.map((a) => ({ ...a, active: false }));
    expect(resolveScores(none, { generalScore: 25, resultScore: 60 })).toEqual({ generalScore: 25, resultScore: 60, axes: null });
    expect(() => resolveScores(none, { generalScore: 31, resultScore: 60 })).toThrow(/từ 0 đến 30/);
    expect(() => resolveScores(none, { generalScore: 25, resultScore: 71 })).toThrow(/từ 0 đến 70/);
    expect(() => resolveScores(none, { generalScore: 25 })).toThrow(/từ 0 đến 70/);
  });
});

describe('gợi ý tự động', () => {
  it('T2 gợi ý điểm tối đa nhân tỷ lệ việc hoàn thành; trục khác và chưa có việc thì không gợi ý', () => {
    expect(suggestedScores(DEFAULT_AXES, { works: 8, completed: 6, onTime: 5, exceeded: 1, late: 1 })).toEqual({ T2: 15 });
    expect(suggestedScores(DEFAULT_AXES, { works: 0, completed: 0, onTime: 0, exceeded: 0, late: 0 })).toEqual({});
    expect(suggestedScores(DEFAULT_AXES.map((a) => ({ ...a, active: false })), { works: 4, completed: 4, onTime: 4, exceeded: 0, late: 0 })).toEqual({});
  });
});
