import { computeStats, excellentQuota } from './report-builder.js';
import { approved, pending, report, row } from './testing/fixtures.js';

describe('excellentQuota (hạn mức xuất sắc, chỉ tham khảo)', () => {
  const quota = (excellent: number, good: number) =>
    excellentQuota({ XUAT_SAC: excellent, HOAN_THANH_TOT: good, HOAN_THANH: 0, KHONG_HOAN_THANH: 0 });

  it('tối đa 20% số hoàn thành tốt, làm tròn từ 0,5 trở lên thành 1', () => {
    expect(quota(0, 0).allowed).toBe(0);
    expect(quota(0, 2).allowed).toBe(0); // 0,4 -> 0
    expect(quota(0, 3).allowed).toBe(1); // 0,6 -> 1
    expect(quota(0, 5).allowed).toBe(1); // 1,0
    expect(quota(0, 10).allowed).toBe(2);
    expect(quota(0, 12).allowed).toBe(2); // 2,4 -> 2
    expect(quota(0, 13).allowed).toBe(3); // 2,6 -> 3
  });

  it('đúng 0,5 thì làm tròn lên (không bị sai số dấu phẩy động)', () => {
    // 0,2 × 2,5 không xảy ra với số nguyên; kiểm tra gần biên: 0,2 × 7 = 1,4 -> 1; 0,2 × 8 = 1,6 -> 2
    expect(quota(0, 7).allowed).toBe(1);
    expect(quota(0, 8).allowed).toBe(2);
  });

  it('cờ vượt khi số xuất sắc lớn hơn mức tối đa', () => {
    expect(quota(1, 5).exceeded).toBe(false);
    expect(quota(2, 5).exceeded).toBe(true);
    expect(quota(1, 0).exceeded).toBe(true); // chưa tính ngoại lệ "dưới 5 đối tượng"
    expect(quota(0, 0).exceeded).toBe(false);
  });
});

describe('computeStats', () => {
  it('chỉ tính điểm và xếp loại trên hồ sơ đã phê duyệt', () => {
    const stats = computeStats([
      approved('A', 92, 'XUAT_SAC'),
      approved('B', 80, 'HOAN_THANH_TOT'),
      approved('C', 60, 'HOAN_THANH'),
      pending('D', 'REVIEWED', { totalScore: 99, rating: 'XUAT_SAC' }), // đã thẩm định nhưng chưa phê duyệt: không tính vào điểm
      pending('E', 'PLANNED'),
      pending('F', 'SELF_SUBMITTED'),
    ]);
    expect(stats).toMatchObject({
      evaluations: 6,
      approved: 3,
      pendingApproval: 1,
      inProgress: 2,
      completionRate: 0.5,
      averageTotal: 77.33,
      minTotal: 60,
      maxTotal: 92,
    });
    expect(stats.ratings).toEqual({ XUAT_SAC: 1, HOAN_THANH_TOT: 1, HOAN_THANH: 1, KHONG_HOAN_THANH: 0 });
  });

  it('không có hồ sơ hoặc chưa có hồ sơ nào được duyệt thì các số liệu điểm rỗng, không chia cho 0', () => {
    expect(computeStats([])).toMatchObject({ evaluations: 0, approved: 0, completionRate: null, averageTotal: null, minTotal: null, maxTotal: null });
    expect(computeStats([pending('A', 'PLANNED')])).toMatchObject({ completionRate: 0, averageTotal: null });
  });
});

describe('buildPeriodReport', () => {
  const rows = [
    approved('Trần Thị B', 91, 'XUAT_SAC', { unitCode: 'VP', unitName: 'Văn phòng', level: 5 }),
    approved('Nguyễn Văn A', 85, 'HOAN_THANH_TOT', { unitCode: 'TCCB', unitName: 'Phòng Tổ chức cán bộ', level: 5 }),
    approved('Lê Văn C', 75, 'HOAN_THANH_TOT', { unitCode: 'TCCB', unitName: 'Phòng Tổ chức cán bộ', level: 3, positionTitle: 'Trưởng phòng' }),
    pending('Phạm Thị D', 'SELF_SUBMITTED', { unitCode: 'VP', unitName: 'Văn phòng' }),
  ];

  it('gom theo đơn vị, sắp theo tên đơn vị; trong đơn vị sắp theo cấp rồi theo tên', () => {
    const r = report(rows);
    expect(r.byUnit.map((u) => u.unitCode)).toEqual(['TCCB', 'VP']); // "Phòng Tổ chức cán bộ" đứng trước "Văn phòng" theo thứ tự tiếng Việt
    expect(r.rows.map((x) => x.fullName)).toEqual(['Lê Văn C', 'Nguyễn Văn A', 'Phạm Thị D', 'Trần Thị B']);

    const tccb = r.byUnit.find((u) => u.unitCode === 'TCCB')!;
    expect(tccb).toMatchObject({ evaluations: 2, approved: 2, averageTotal: 80 });
    const vp = r.byUnit.find((u) => u.unitCode === 'VP')!;
    expect(vp).toMatchObject({ evaluations: 2, approved: 1, inProgress: 1, averageTotal: 91 });
    expect(r.overall).toMatchObject({ evaluations: 4, approved: 3, averageTotal: 83.67 });
  });

  it('cộng các đơn vị khớp với tổng chung', () => {
    const r = report(rows);
    expect(r.byUnit.reduce((n, u) => n + u.evaluations, 0)).toBe(r.overall.evaluations);
    expect(r.byUnit.reduce((n, u) => n + u.approved, 0)).toBe(r.overall.approved);
    for (const rating of ['XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH', 'KHONG_HOAN_THANH'] as const) {
      expect(r.byUnit.reduce((n, u) => n + u.ratings[rating], 0)).toBe(r.overall.ratings[rating]);
    }
  });

  it('ghi chú: luôn có cảnh báo về xếp loại theo ngưỡng; chính sách điểm; hồ sơ chưa duyệt', () => {
    const notes = report(rows).notes.join('\n');
    expect(notes).toMatch(/ngưỡng điểm 90\/70\/50/);
    expect(notes).toMatch(/chính sách v1-gia-dinh/);
    expect(notes).toMatch(/Còn 1 hồ sơ chưa phê duyệt/);
  });

  it('ghi chú cảnh báo phạm vi giới hạn, chỉ khi giới hạn', () => {
    expect(report(rows, { scope: 'LIMITED' }).notes.join('\n')).toMatch(/phạm vi của bạn/);
    expect(report(rows, { scope: 'ALL' }).notes.join('\n')).not.toMatch(/phạm vi của bạn/);
  });

  it('ghi chú cảnh báo khi số xuất sắc vượt mức tham khảo', () => {
    const r = report([approved('A', 95, 'XUAT_SAC'), approved('B', 96, 'XUAT_SAC'), approved('C', 80, 'HOAN_THANH_TOT')]);
    expect(r.overall.excellentQuota).toMatchObject({ excellent: 2, good: 1, allowed: 0, exceeded: true });
    expect(r.notes.join('\n')).toMatch(/vượt mức tham khảo 0/);
  });

  it('báo cáo rỗng vẫn hợp lệ', () => {
    const r = report([], { policyVersions: [] });
    expect(r.rows).toEqual([]);
    expect(r.byUnit).toEqual([]);
    expect(r.overall.evaluations).toBe(0);
    expect(r.notes.join('\n')).not.toMatch(/chính sách/);
  });

  it('không chứa nhận xét hay minh chứng trong dòng báo cáo (giảm dữ liệu nhạy cảm)', () => {
    const keys = Object.keys(row({ fullName: 'A' }));
    for (const forbidden of ['selfComment', 'reviewComment', 'approveComment', 'evidence', 'returnReason']) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
