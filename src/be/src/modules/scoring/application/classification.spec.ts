import { classifyByScore, totalScore } from './classification.js';

describe('classifyByScore (39-QĐ/TU Điều 11)', () => {
  it.each([
    [100, 'XUAT_SAC'],
    [90, 'XUAT_SAC'],
    [89.99, 'HOAN_THANH_TOT'],
    [70, 'HOAN_THANH_TOT'],
    [69.99, 'HOAN_THANH'],
    [50, 'HOAN_THANH'],
    [49.99, 'KHONG_HOAN_THANH'],
    [0, 'KHONG_HOAN_THANH'],
  ])('điểm %s xếp loại %s', (score, expected) => {
    expect(classifyByScore(score)).toBe(expected);
  });

  it('cho phép đổi ngưỡng theo cấu hình', () => {
    expect(classifyByScore(85, { excellent: 85, good: 70, fair: 50 })).toBe('XUAT_SAC');
  });

  it('từ chối điểm ngoài thang', () => {
    expect(() => classifyByScore(101)).toThrow(RangeError);
    expect(() => classifyByScore(-1)).toThrow(RangeError);
    expect(() => classifyByScore(Number.NaN)).toThrow(RangeError);
  });
});

describe('totalScore (05-HD/TU: 30 + 70)', () => {
  it('cộng điểm chung và điểm kết quả', () => {
    expect(totalScore(28, 62)).toBe(90);
  });

  it('từ chối vượt trần từng nhóm', () => {
    expect(() => totalScore(31, 0)).toThrow(RangeError);
    expect(() => totalScore(0, 71)).toThrow(RangeError);
  });
});
