import { buildDraft, DRAFT_DISCLAIMER, formatNumber, formatPercent } from './draft-templates.js';
import { approved, pending, report } from './testing/fixtures.js';

describe('định dạng số kiểu Việt Nam', () => {
  it('dấu phẩy thập phân; rỗng thành gạch ngang', () => {
    expect(formatNumber(89)).toBe('89,00');
    expect(formatNumber(77.333)).toBe('77,33');
    expect(formatNumber(null)).toBe('–');
    expect(formatPercent(0.5)).toBe('50,0%');
    expect(formatPercent(null)).toBe('–');
  });
});

describe('dự thảo báo cáo', () => {
  const r = report([
    approved('Nguyễn Văn A', 92, 'XUAT_SAC'),
    approved('Trần Thị B', 80, 'HOAN_THANH_TOT', { unitCode: 'VP', unitName: 'Văn phòng' }),
    pending('Lê Văn C', 'SELF_SUBMITTED'),
  ]);
  const draft = buildDraft('REPORT', r);

  it('nêu đúng kỳ, số hồ sơ và tỷ lệ', () => {
    expect(draft.body).toContain('kỳ 2026-Q3 (từ 2026-07-01 đến 2026-09-30)');
    expect(draft.body).toContain('Tổng số hồ sơ đánh giá: 3; đã phê duyệt: 2');
    expect(draft.body).toContain('tỷ lệ hoàn tất 66,7%');
    expect(draft.body).toContain('Hoàn thành xuất sắc nhiệm vụ: 1 người (50,0%)');
    expect(draft.body).toContain('Điểm trung bình: 86,00; thấp nhất: 80,00; cao nhất: 92,00');
  });

  it('chiếu đúng các văn bản có trong bộ tài liệu, không bịa số hiệu khác', () => {
    expect(draft.body).toContain('Quy định số 39-QĐ/TU, ngày 28/11/2025');
    expect(draft.body).toContain('Hướng dẫn số 05-HD/TU, ngày 16/6/2026');
  });

  it('để trống số, ngày, người ký và phần nhận định thay vì tự điền', () => {
    expect(draft.body).toMatch(/Số: …-BC\/BTCTU/);
    expect(draft.body).toMatch(/ngày … tháng … năm …/);
    expect(draft.body).toContain('[Cần bổ sung]');
    expect(draft.body).toContain('TRƯỞNG BAN');
  });

  it('có mục theo từng đơn vị', () => {
    // Phòng TCCB có 2 hồ sơ (1 đã duyệt, 1 đang tự chấm); Văn phòng có 1 hồ sơ đã duyệt.
    expect(draft.body).toMatch(/1\. Phòng Tổ chức cán bộ: 1\/2 hồ sơ đã phê duyệt/);
    expect(draft.body).toMatch(/2\. Văn phòng: 1\/1 hồ sơ đã phê duyệt/);
  });

  it('luôn kèm tuyên bố đây là dự thảo chỉ để tham khảo', () => {
    expect(draft.disclaimer).toBe(DRAFT_DISCLAIMER);
    expect(draft.disclaimer).toMatch(/DỰ THẢO, chỉ để tham khảo/);
    expect(draft.title).toMatch(/^Dự thảo/);
  });

  it('cảnh báo trong văn bản khi số xuất sắc vượt mức tham khảo', () => {
    const over = buildDraft('REPORT', report([approved('A', 95, 'XUAT_SAC'), approved('B', 96, 'XUAT_SAC')]));
    expect(over.body).toMatch(/Lưu ý: số xuất sắc \(2\) vượt mức tham khảo 0/);

    // 1 xuất sắc trên 5 hoàn thành tốt (mức tối đa 1) thì không cảnh báo.
    const fine = buildDraft('REPORT', report([approved('A', 95, 'XUAT_SAC'), ...['B', 'C', 'D', 'E', 'F'].map((n) => approved(n, 80, 'HOAN_THANH_TOT'))]));
    expect(fine.body).not.toMatch(/Lưu ý: số xuất sắc/);
  });

  it('kỳ chưa có hồ sơ vẫn ra văn bản hợp lệ', () => {
    const empty = buildDraft('REPORT', report([]));
    expect(empty.body).toContain('(Chưa có hồ sơ đánh giá trong kỳ.)');
    expect(empty.approvedCount).toBe(0);
  });
});

describe('dự thảo quyết định', () => {
  const r = report([
    approved('Nguyễn Văn A', 92, 'XUAT_SAC'),
    approved('Trần Thị B', 80, 'HOAN_THANH_TOT', { unitCode: 'VP', unitName: 'Văn phòng', positionTitle: 'Văn thư' }),
    pending('Lê Văn C', 'REVIEWED', { totalScore: 70, rating: 'HOAN_THANH_TOT' }),
    pending('Phạm Thị D', 'PLANNED'),
  ]);
  const draft = buildDraft('DECISION', r);

  it('chỉ liệt kê các hồ sơ đã phê duyệt, kèm điểm và xếp loại', () => {
    expect(draft.approvedCount).toBe(2);
    expect(draft.body).toContain('đối với 2 cán bộ, công chức');
    expect(draft.body).toMatch(/Nguyễn Văn A – Chuyên viên \(Phòng Tổ chức cán bộ\): 92,00 điểm, Hoàn thành xuất sắc nhiệm vụ\./);
    expect(draft.body).toMatch(/Trần Thị B – Văn thư \(Văn phòng\): 80,00 điểm, Hoàn thành tốt nhiệm vụ\./);
    expect(draft.body).not.toContain('Lê Văn C'); // đã thẩm định nhưng chưa phê duyệt
    expect(draft.body).not.toContain('Phạm Thị D');
  });

  it('có đủ các điều và các chỗ trống cần người có thẩm quyền hoàn thiện', () => {
    expect(draft.body).toContain('Điều 1.');
    expect(draft.body).toContain('Điều 2.');
    expect(draft.body).toContain('Điều 3.');
    expect(draft.body).toMatch(/Số: …-QĐ\/BTCTU/);
    expect(draft.disclaimer).toBe(DRAFT_DISCLAIMER);
  });

  it('chưa có hồ sơ nào được phê duyệt thì nói rõ', () => {
    const none = buildDraft('DECISION', report([pending('A', 'PLANNED')]));
    expect(none.body).toContain('(Chưa có hồ sơ nào được phê duyệt trong kỳ.)');
    expect(none.approvedCount).toBe(0);
  });
});

describe('dự thảo thông báo kết quả và báo cáo năm (A7)', () => {
  const rows = [
    approved('Nguyễn Văn A', 92, 'XUAT_SAC'),
    approved('Trần Thị B', 80, 'HOAN_THANH_TOT', { unitCode: 'VP', unitName: 'Văn phòng' }),
    pending('Lê Văn C', 'SELF_SUBMITTED'),
  ];

  it('thông báo nêu số liệu chung và theo đơn vị, không nêu tên cán bộ, còn chỗ trống cho số, ngày, hạn phản ánh', () => {
    const draft = buildDraft('NOTICE', report(rows));
    expect(draft.kind).toBe('NOTICE');
    expect(draft.title).toMatch(/^Dự thảo thông báo/);
    expect(draft.body).toContain('THÔNG BÁO');
    expect(draft.body).toContain('Đã phê duyệt 2/3 hồ sơ');
    expect(draft.body).toContain('Văn phòng: 1/1 hồ sơ đã phê duyệt');
    expect(draft.body).toContain('-TB/BTCTU');
    expect(draft.body).toContain('Quyết định số …-QĐ/BTCTU');
    expect(draft.body).not.toContain('Nguyễn Văn A');
    expect(draft.body).not.toContain('Lê Văn C');
    expect(draft.disclaimer).toBe(DRAFT_DISCLAIMER);
    expect(draft.approvedCount).toBe(2);
  });

  it('thông báo cho kỳ chưa có hồ sơ vẫn dựng được', () => {
    expect(buildDraft('NOTICE', report([])).body).toContain('(Chưa có hồ sơ đánh giá trong kỳ.)');
  });

  it('báo cáo kỳ năm có ghi chú điểm năm và số hồ sơ không xếp loại; kỳ quý thì không', () => {
    const base = report([...rows, approved('Phạm Thị D', 0, 'HOAN_THANH', { rating: null, totalScore: null })]);
    const quarter = buildDraft('REPORT', base);
    expect(quarter.body).not.toContain('GHI CHÚ VỀ ĐIỂM NĂM');
    const year = buildDraft('REPORT', { ...base, period: { ...base.period, type: 'YEAR', label: '2026' } });
    expect(year.body).toContain('V. GHI CHÚ VỀ ĐIỂM NĂM');
    expect(year.body).toContain('trung bình cộng điểm các tháng');
    expect(year.body).toContain('không xếp loại" do chưa đủ 6 tháng công tác trong năm (Điều 11.1): 1.');
  });
});
