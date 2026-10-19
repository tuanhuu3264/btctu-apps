import { DEFAULT_RETENTION, formatStamp, parseStamp, selectKeep } from './retention.js';

const stampsOf = (dates: string[]) => dates.map((d) => formatStamp(new Date(`${d}Z`)));

describe('sao lưu: thời hạn giữ bản', () => {
  it('đọc và ghi tên thư mục theo giờ UTC; tên sai dạng thì bỏ qua', () => {
    expect(formatStamp(new Date('2026-10-18T21:05:09Z'))).toBe('20261018-210509');
    expect(parseStamp('20261018-210509')?.toISOString()).toBe('2026-10-18T21:05:09.000Z');
    expect(parseStamp('20261318-210509')).toBeNull();
    expect(parseStamp('khac')).toBeNull();
  });

  it('mỗi ngày giữ bản mới nhất; chạy nhiều lần trong ngày không chiếm chỗ của các ngày khác', () => {
    const stamps = stampsOf(['2026-10-18T01:00:00', '2026-10-18T13:00:00', '2026-10-17T02:00:00', '2026-10-16T02:00:00']);
    const keep = selectKeep(stamps, { daily: 2, weekly: 0, monthly: 0 });
    expect([...keep].sort()).toEqual(stampsOf(['2026-10-17T02:00:00', '2026-10-18T13:00:00']).sort());
  });

  it('giữ thêm bản mới nhất của các tuần và tháng trước dù đã quá số ngày', () => {
    const days = Array.from({ length: 70 }, (_, i) => new Date(Date.UTC(2026, 9, 18 - i, 2, 0, 0)).toISOString().slice(0, 19));
    const stamps = stampsOf(days);
    const keep = selectKeep(stamps, DEFAULT_RETENTION);
    expect(keep.size).toBeGreaterThan(7);
    expect(keep.size).toBeLessThanOrEqual(7 + 4 + 12);
    expect(keep.has(stamps[0])).toBe(true); // bản mới nhất
    expect(keep.has(stamps[69])).toBe(false); // 70 ngày trước, không phải bản đại diện của tuần hay tháng nào còn được giữ
  });

  it('bản mới nhất luôn được giữ kể cả khi chính sách bằng 0; thư mục lạ không bao giờ bị chọn xóa', () => {
    const stamps = [...stampsOf(['2026-10-18T01:00:00', '2026-10-01T01:00:00']), 'ghi-chu'];
    const keep = selectKeep(stamps, { daily: 0, weekly: 0, monthly: 0 });
    expect([...keep]).toEqual([stamps[0]]);
    expect(keep.has('ghi-chu')).toBe(false);
  });
});
