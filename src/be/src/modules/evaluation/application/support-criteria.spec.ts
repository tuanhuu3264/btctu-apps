import { BadRequestException } from '@nestjs/common';
import { checkSupportScores, supportRate, supportResultScore } from './support-criteria.js';

describe('tiêu chí người lao động hỗ trợ, phục vụ (Sổ tay Bộ Nội vụ Chương III)', () => {
  it('điểm đánh giá = (a + b + c) / 3, điểm kết quả = điểm đánh giá × 70', () => {
    const s = { quality: 100, compliance: 90, efficiency: 80 };
    expect(supportRate(s)).toBe(0.9);
    expect(supportResultScore(s)).toBe(63);
    expect(supportResultScore({ quality: 100, compliance: 100, efficiency: 100 })).toBe(70);
    expect(supportResultScore({ quality: 0, compliance: 0, efficiency: 0 })).toBe(0);
    expect(supportResultScore({ quality: 100, compliance: 50, efficiency: 50 })).toBe(46.67);
  });

  it('thiếu, ngoài 0 đến 100 hoặc không phải số thì bị từ chối', () => {
    expect(() => checkSupportScores(undefined, 'Người quản lý')).toThrow(/Người quản lý cần chấm ba tiêu chí/);
    expect(() => checkSupportScores({ quality: 101, compliance: 90, efficiency: 80 }, 'x')).toThrow(/Chất lượng công việc phải từ 0 đến 100/);
    expect(() => checkSupportScores({ quality: 90, compliance: -1, efficiency: 80 }, 'x')).toThrow(/Tuân thủ/);
    expect(() => checkSupportScores({ quality: 90, compliance: 90, efficiency: Number.NaN }, 'x')).toThrow(BadRequestException);
    expect(checkSupportScores({ quality: 90.456, compliance: 90, efficiency: 80 }, 'x')).toEqual({ quality: 90.46, compliance: 90, efficiency: 80 });
  });
});
