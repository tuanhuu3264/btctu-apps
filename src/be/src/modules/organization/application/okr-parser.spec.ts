import { keyResultLabel, parseOkr } from './okr-parser.js';

describe('tách cột OKR của tệp sơ đồ phân công', () => {
  it('dạng "O: ... KR1: ... KR2: ..."', () => {
    const p = parseOkr('O: Nâng cao hiệu lực điều hành, chất lượng VP và tổng hợp. KR1: 100% VB đến/đi đúng hạn. KR2: Đôn đốc phòng ≥95% nhiệm vụ. KR3: 100% việc ủy quyền báo cáo kịp thời. KR4: 100% chỉ tiêu KH CĐS cơ quan.')!;
    expect(p.objective).toBe('Nâng cao hiệu lực điều hành, chất lượng VP và tổng hợp');
    expect(p.keyResults.map((k) => k.code)).toEqual(['KR1', 'KR2', 'KR3', 'KR4']);
    expect(p.keyResults[1].text).toBe('Đôn đốc phòng ≥95% nhiệm vụ');
  });

  it('dạng chỉ có "KR1: ..." không có Mục tiêu', () => {
    const p = parseOkr('KR1: 100% hồ sơ chế độ, chính sách đúng hạn. KR2: Lễ tang, phúng viếng chu đáo, đúng quy định.')!;
    expect(p.objective).toBeNull();
    expect(p.keyResults).toEqual([
      { code: 'KR1', text: '100% hồ sơ chế độ, chính sách đúng hạn' },
      { code: 'KR2', text: 'Lễ tang, phúng viếng chu đáo, đúng quy định' },
    ]);
  });

  it('mã gộp "KR4–KR7" giữ nguyên là một mục', () => {
    const p = parseOkr('KR1: 100% VB đến chuyển trong ngày. KR4–KR7: Lưu trữ, tài liệu họp, VPP, thủ quỹ 100%.')!;
    expect(p.keyResults.map((k) => k.code)).toEqual(['KR1', 'KR4–KR7']);
  });

  it('dạng "KPI: ... OKR: a; b; c": các ý cách nhau dấu chấm phẩy, đánh mã KR1...', () => {
    const p = parseOkr('KPI: Thẩm định, soạn thảo, trình ký. OKR: 100% Đề án đúng; hoàn thành danh mục VTVL đúng tiến độ; ≥90% báo cáo đúng hạn.')!;
    expect(p.objective).toBeNull();
    expect(p.keyResults).toEqual([
      { code: 'KR1', text: '100% Đề án đúng' },
      { code: 'KR2', text: 'hoàn thành danh mục VTVL đúng tiến độ' },
      { code: 'KR3', text: '≥90% báo cáo đúng hạn' },
    ]);
  });

  it('hướng chỉ đạo của lãnh đạo là Mục tiêu, không có kết quả then chốt', () => {
    const p = parseOkr('Chỉ đạo lĩnh vực ĐTBD, tuyển dụng, tiền lương, nghỉ công tác')!;
    expect(p.objective).toBe('Chỉ đạo lĩnh vực ĐTBD, tuyển dụng, tiền lương, nghỉ công tác');
    expect(p.keyResults).toEqual([]);
  });

  it('dạng các câu liền nhau: mỗi câu một kết quả then chốt', () => {
    const p = parseOkr('Kết nạp ĐV 3–4%/tổng số ĐV. ĐV ĐH trở lên tăng so nhiệm kỳ trước. Bí thư, PBT cấp ủy có TCLLCT từ TC trở lên ≥95% (trừ DN ngoài NN). 100% ĐV được phân công nhiệm vụ.')!;
    expect(p.keyResults.map((k) => k.code)).toEqual(['KR1', 'KR2', 'KR3', 'KR4']);
    expect(p.keyResults[2].text).toBe('Bí thư, PBT cấp ủy có TCLLCT từ TC trở lên ≥95% (trừ DN ngoài NN)');
  });

  it('rỗng hoặc thiếu thì không có OKR; luôn giữ nguyên văn', () => {
    expect(parseOkr(null)).toBeNull();
    expect(parseOkr('   ')).toBeNull();
    expect(parseOkr('KR1:  a  b.')!.raw).toBe('KR1: a b.');
  });

  it('nhãn đầy đủ của kết quả then chốt', () => {
    expect(keyResultLabel({ code: 'KR2', text: 'Đôn đốc phòng ≥95% nhiệm vụ' })).toBe('KR2: Đôn đốc phòng ≥95% nhiệm vụ');
  });
});
