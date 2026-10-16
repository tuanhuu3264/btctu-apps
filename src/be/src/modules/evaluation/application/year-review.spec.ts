import { BadRequestException, ConflictException } from '@nestjs/common';
import { actorOf, buildEvaluation, PEOPLE, seedPlanned } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

/** Hồ sơ tháng đã phê duyệt của `staff` với điểm chung và điểm kết quả cho trước. */
async function approvedMonth(h: Harness, month: number, general: number, result: number) {
  const period = await h.service.createPeriod(actorOf('head'), { type: 'MONTH', year: 2026, number: month });
  const file = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
  await h.repos.evaluations.update(file.id, { status: 'APPROVED', generalScore: general, resultScore: result, totalScore: general + result, rating: 'HOAN_THANH_TOT' });
}

async function yearFile(h: Harness) {
  const period = await h.service.createPeriod(actorOf('head'), { type: 'YEAR', year: 2026 });
  return h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
}

describe('EvaluationService: điểm năm là trung bình các tháng đã phê duyệt (ADR-035)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('cán bộ nộp hồ sơ năm không cần điểm; người thẩm định không nhập điểm, hệ thống lấy trung bình 6 tháng', async () => {
    for (let m = 1; m <= 6; m++) await approvedMonth(h, m, m % 2 ? 24 : 26, m % 2 ? 60 : 62);
    const year = await yearFile(h);

    await h.service.selfSubmit(actorOf('staff'), year.id, {});
    // điểm người thẩm định gửi lên bị bỏ qua
    const view = await h.service.review(actorOf('head'), year.id, { generalScore: 5, comment: 'Đồng ý' });
    expect(view.evaluation).toMatchObject({ status: 'REVIEWED', generalScore: 25, resultScore: 61, totalScore: 86, rating: 'HOAN_THANH_TOT' });
    expect(view.evaluation.scoringParams).toMatchObject({ policy: 'avg-months', missing: [7, 8, 9, 10, 11, 12] });
    expect((view.evaluation.scoringParams as { months: unknown[] }).months).toHaveLength(6);
    expect(h.audit.find((a) => a.action === 'evaluation.review')?.details).toMatchObject({ policy: 'avg-months', months: 6, totalScore: 86 });

    const approved = await h.service.approve(actorOf('deputy'), year.id);
    expect(approved.evaluation).toMatchObject({ status: 'APPROVED', totalScore: 86 });
  });

  it('dưới 6 tháng đã phê duyệt thì không thẩm định được (Điều 11.1)', async () => {
    for (let m = 1; m <= 5; m++) await approvedMonth(h, m, 25, 60);
    const year = await yearFile(h);
    await h.service.selfSubmit(actorOf('staff'), year.id, {});
    await expect(h.service.review(actorOf('head'), year.id, {})).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.review(actorOf('head'), year.id, {})).rejects.toThrow(/5 tháng.*ít nhất 6 tháng/);
    expect((await h.repos.evaluations.findById(year.id))!.status).toBe('SELF_SUBMITTED');
  });

  it('chỉ tính tháng đã phê duyệt: tháng đang thẩm định hoặc chưa duyệt bị bỏ qua', async () => {
    for (let m = 1; m <= 6; m++) await approvedMonth(h, m, 25, 65);
    const pending = await h.service.createPeriod(actorOf('head'), { type: 'MONTH', year: 2026, number: 7 });
    const file = await h.repos.evaluations.create({ periodId: pending.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
    await h.repos.evaluations.update(file.id, { status: 'REVIEWED', generalScore: 5, resultScore: 5, totalScore: 10 });
    const year = await yearFile(h);
    const view = await h.service.getEvaluation(actorOf('head'), year.id, false);
    expect(view.yearAverage).toMatchObject({ enough: true, totalScore: 90, rating: 'XUAT_SAC' });
    expect(view.yearAverage?.missing).toContain(7);
  });

  it('xem trước hồ sơ năm: điểm trung bình, cảnh báo tháng thiếu và chưa đủ tháng', async () => {
    for (const m of [1, 2, 3, 4, 5, 6, 8]) await approvedMonth(h, m, 25, 60);
    const year = await yearFile(h);
    const view = await h.service.getEvaluation(actorOf('head'), year.id, false);
    expect(view.preview).toMatchObject({ totalScore: 85, rating: 'HOAN_THANH_TOT', complete: true });
    expect(view.yearAverage?.months).toHaveLength(7);
    expect(view.warnings.join('|')).toMatch(/tháng 7, 9, 10, 11, 12.*Điều 11\.2/);
    expect(view.leadershipSuggestion).toBeNull();

    const few = await buildEvaluation();
    for (const m of [1, 2, 3]) await approvedMonth(few, m, 25, 60);
    const f = await few.service.createPeriod(actorOf('head'), { type: 'YEAR', year: 2026 });
    const fewYear = await few.repos.evaluations.create({ periodId: f.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
    const fv = await few.service.getEvaluation(actorOf('head'), fewYear.id, false);
    expect(fv.preview).toMatchObject({ complete: false, rating: null });
    expect(fv.warnings.join('|')).toMatch(/Mới có 3 tháng.*chưa đủ 6 tháng/);
  });

  it('kỳ tháng, quý vẫn bắt buộc điểm tiêu chí chung khi tự chấm và thẩm định', async () => {
    const { evaluation } = await seedPlanned(h);
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.review(actorOf('head'), evaluation.id, { tasks: [] })).rejects.toBeInstanceOf(ConflictException); // chưa nộp
  });

  it('hồ sơ đã thẩm định giữ điểm đã lưu dù tháng nào đó đổi sau đó', async () => {
    for (let m = 1; m <= 6; m++) await approvedMonth(h, m, 25, 60);
    const year = await yearFile(h);
    await h.service.selfSubmit(actorOf('staff'), year.id, {});
    await h.service.review(actorOf('head'), year.id, {});
    await approvedMonth(h, 7, 30, 70); // tháng mới duyệt thêm sau khi đã thẩm định
    const view = await h.service.getEvaluation(actorOf('head'), year.id, false);
    expect(view.preview).toMatchObject({ totalScore: 85, rating: 'HOAN_THANH_TOT' });
    expect(view.evaluation.totalScore).toBe(85);
  });
});

describe('EvaluationService: tháng nghỉ và không xếp loại (ADR-039)', () => {
  let h: Harness;
  const office = { id: 'acc-office', username: 'vp', personId: null };
  beforeEach(async () => {
    h = await buildEvaluation();
  });

  it('Văn phòng ghi nhận tháng nghỉ: hồ sơ năm đủ điều kiện nhờ tháng nghỉ, trung bình chỉ trên tháng đã phê duyệt', async () => {
    for (let m = 1; m <= 3; m++) await approvedMonth(h, m, 25, 60);
    const year = await yearFile(h);
    await h.service.selfSubmit(actorOf('staff'), year.id, {});
    await expect(h.service.review(actorOf('head'), year.id, {})).rejects.toBeInstanceOf(ConflictException);

    const saved = await h.service.setLeave(office, PEOPLE.staff, 2026, [
      { month: 4, reason: 'THAI_SAN', note: 'QĐ nghỉ thai sản số 12' },
      { month: 5, reason: 'THAI_SAN', note: 'QĐ nghỉ thai sản số 12' },
      { month: 6, reason: 'THAI_SAN', note: 'QĐ nghỉ thai sản số 12' },
    ]);
    expect(saved.map((s) => s.month)).toEqual([4, 5, 6]);
    expect(h.audit.map((a) => a.action)).toContain('evaluation.leave.update');

    const view = await h.service.review(actorOf('head'), year.id, {});
    expect(view.evaluation).toMatchObject({ status: 'REVIEWED', totalScore: 85 });
    expect(view.evaluation.scoringParams).toMatchObject({ exempt: [4, 5, 6], missing: [7, 8, 9, 10, 11, 12] });
    expect(view.yearAverage?.exempt).toEqual([4, 5, 6]);
  });

  it('kiểm tra khi ghi nhận nghỉ: căn cứ, lý do, tháng trùng, tháng đã có hồ sơ phê duyệt, hồ sơ năm đã khóa', async () => {
    await approvedMonth(h, 3, 25, 60);
    await expect(h.service.setLeave(office, PEOPLE.staff, 2026, [{ month: 4, reason: 'OM', note: '' }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.setLeave(office, PEOPLE.staff, 2026, [{ month: 13, reason: 'OM', note: 'Giấy ra viện' }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.setLeave(office, PEOPLE.staff, 2026, [{ month: 4, reason: 'XYZ' as 'OM', note: 'Giấy ra viện' }])).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.setLeave(office, PEOPLE.staff, 2026, [
        { month: 4, reason: 'OM', note: 'Giấy ra viện' },
        { month: 4, reason: 'OM', note: 'Giấy ra viện' },
      ]),
    ).rejects.toThrow(/hai lần/);
    await expect(h.service.setLeave(office, PEOPLE.staff, 2026, [{ month: 3, reason: 'OM', note: 'Giấy ra viện' }])).rejects.toThrow(/đã có hồ sơ được phê duyệt/);

    const year = await yearFile(h);
    await h.repos.evaluations.update(year.id, { status: 'APPROVED' });
    await expect(h.service.setLeave(office, PEOPLE.staff, 2026, [{ month: 4, reason: 'OM', note: 'Giấy ra viện' }])).rejects.toThrow(/đã khóa/);
  });

  it('chỉ chính chủ, cấp trên hoặc người có quyền xem tất cả xem được tháng nghỉ', async () => {
    await h.service.setLeave(office, PEOPLE.staff, 2026, [{ month: 4, reason: 'OM', note: 'Giấy ra viện' }]);
    expect(await h.service.leaveOf(actorOf('staff'), PEOPLE.staff, 2026, false)).toHaveLength(1);
    expect(await h.service.leaveOf(actorOf('head'), PEOPLE.staff, 2026, false)).toHaveLength(1);
    await expect(h.service.leaveOf(actorOf('other'), PEOPLE.staff, 2026, false)).rejects.toThrow(/không được xem/);
    expect(await h.service.leaveOf(actorOf('other'), PEOPLE.staff, 2026, true)).toHaveLength(1);
  });

  it('đóng hồ sơ "không xếp loại" khi chưa đủ 6 tháng; hồ sơ khóa, không điểm, có nhật ký và thông báo', async () => {
    for (let m = 1; m <= 4; m++) await approvedMonth(h, m, 25, 60);
    const year = await yearFile(h);
    await expect(h.service.closeNotRated(actorOf('staff'), year.id)).rejects.toThrow(/không phải người có thẩm quyền/);
    const view = await h.service.closeNotRated(actorOf('head'), year.id, 'Mới tiếp nhận từ tháng 9');
    expect(view.evaluation).toMatchObject({ status: 'APPROVED', totalScore: null, rating: null });
    expect(view.evaluation.notRatedReason).toMatch(/Chưa đủ 6 tháng.*Điều 11\.1.*Mới tiếp nhận từ tháng 9/);
    expect(h.audit.map((a) => a.action)).toContain('evaluation.not-rated');
    expect(h.notifier.of('EVAL_APPROVED')).toEqual([expect.objectContaining({ to: [PEOPLE.staff] })]);
    await expect(h.service.closeNotRated(actorOf('head'), year.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('đủ điều kiện xếp loại thì không đóng "không xếp loại" được; kỳ tháng không có thao tác này', async () => {
    for (let m = 1; m <= 6; m++) await approvedMonth(h, m, 25, 60);
    const year = await yearFile(h);
    await expect(h.service.closeNotRated(actorOf('head'), year.id)).rejects.toThrow(/Đã đủ 6 tháng/);
    const seeded = await seedPlanned(h);
    await expect(h.service.closeNotRated(actorOf('head'), seeded.evaluation.id)).rejects.toBeInstanceOf(BadRequestException);
  });
});
