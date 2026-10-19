import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { checkRatingEvent, forcedItems, yearConditions } from './rating-events.js';
import type { RatingEventModel } from './rating-events.js';
import { actorOf, buildEvaluation, documentCriteria, marksFor, PEOPLE, seedPlanned } from './testing/in-memory.js';
import type { Harness } from './testing/in-memory.js';

const event = (over: Partial<RatingEventModel>): RatingEventModel => ({
  id: 'e',
  personId: PEOPLE.staff,
  kind: 'KY_LUAT',
  effectiveDate: '2026-08-12',
  decisionNo: '15-QĐ/ĐU',
  form: 'KHIEN_TRACH',
  system: 'DANG',
  reason: 'CONG_VU',
  note: null,
  createdBy: null,
  createdAt: new Date(),
  ...over,
});

describe('checkRatingEvent', () => {
  it('kỷ luật cần hình thức, hệ thống, loại vi phạm; loại khác không được có các trường đó', () => {
    expect(() => checkRatingEvent({ kind: 'KY_LUAT', effectiveDate: '2026-08-12', decisionNo: '15-QĐ' })).toThrow(/hình thức/);
    expect(() => checkRatingEvent({ kind: 'KY_LUAT', effectiveDate: '2026-08-12', decisionNo: '15-QĐ', form: 'CANH_CAO' })).toThrow(/đảng hay kỷ luật hành chính/);
    expect(() => checkRatingEvent({ kind: 'SUY_THOAI', effectiveDate: '2026-08-12', decisionNo: 'KL 3', form: 'CANH_CAO' })).toThrow(/chỉ dùng cho sự kiện kỷ luật/);
    expect(() => checkRatingEvent({ kind: 'SUY_THOAI', effectiveDate: '2026-13-01', decisionNo: 'KL 3' })).toThrow(BadRequestException);
    expect(() => checkRatingEvent({ kind: 'SUY_THOAI', effectiveDate: '2026-08-12', decisionNo: '  ' })).toThrow(/số, ký hiệu/);
    expect(checkRatingEvent({ kind: 'KY_LUAT', effectiveDate: '2026-08-12', decisionNo: ' 15-QĐ ', form: 'CANH_CAO', system: 'HANH_CHINH', reason: 'KHAC' })).toMatchObject({
      decisionNo: '15-QĐ',
      form: 'CANH_CAO',
      system: 'HANH_CHINH',
      reason: 'KHAC',
    });
  });
});

describe('forcedItems', () => {
  it('kỷ luật buộc các mục kỷ luật, đạo đức; tín nhiệm thấp chỉ có ở bảng lãnh đạo', () => {
    expect([...forcedItems([event({})], 'STAFF').keys()]).toEqual(['I.1', 'I.2']);
    expect([...forcedItems([event({})], 'LEADER').keys()]).toEqual(['1.3', '1.5']);
    expect([...forcedItems([event({ kind: 'TIN_NHIEM_THAP', form: null, system: null, reason: null })], 'LEADER').keys()]).toEqual(['1.7']);
    expect(forcedItems([event({ kind: 'TIN_NHIEM_THAP', form: null, system: null, reason: null })], 'STAFF').size).toBe(0);
  });
});

describe('yearConditions (39-QĐ/TU Điều 11 mục 4)', () => {
  const none = { unit: null, own: null };
  it('kỷ luật do vi phạm công vụ hoặc suy thoái là điều kiện; kỷ luật vì lý do khác thì không', () => {
    expect(yearConditions('STAFF', [event({})], none).map((c) => c.code)).toEqual(['KY_LUAT']);
    expect(yearConditions('STAFF', [event({ reason: 'KHAC' })], none)).toEqual([]);
    expect(yearConditions('LEADER', [event({ reason: 'SUY_THOAI' })], none)[0]).toMatchObject({ code: 'KY_LUAT', basis: expect.stringMatching(/4\.2\.c/) });
  });

  it('lãnh đạo: đơn vị phụ trách hoàn thành dưới 70%; tín nhiệm thấp; tham nhũng trong phạm vi', () => {
    const events = [event({ kind: 'TIN_NHIEM_THAP', form: null, system: null, reason: null }), event({ kind: 'THAM_NHUNG_PHAM_VI', form: null, system: null, reason: null })];
    const out = yearConditions('LEADER', events, { unit: { unitName: 'Phòng A', works: 10, completed: 6 }, own: null });
    expect(out.map((c) => c.code)).toEqual(['TIN_NHIEM_THAP', 'THAM_NHUNG_PHAM_VI', 'DON_VI_DUOI_70']);
    expect(out[2].text).toMatch(/Phòng A hoàn thành 6\/10.*60%/);
    expect(yearConditions('LEADER', [], { unit: { unitName: 'Phòng A', works: 10, completed: 7 }, own: null })).toEqual([]);
  });

  it('không giữ chức vụ: trên 50% việc trong năm chưa hoàn thành; tín nhiệm thấp không xét', () => {
    expect(yearConditions('STAFF', [], { unit: null, own: { works: 10, unfinished: 6 } }).map((c) => c.code)).toEqual(['NHIEM_VU_TREN_50']);
    expect(yearConditions('STAFF', [], { unit: null, own: { works: 10, unfinished: 5 } })).toEqual([]);
    expect(yearConditions('STAFF', [event({ kind: 'TIN_NHIEM_THAP', form: null, system: null, reason: null })], none)).toEqual([]);
  });
});

describe('EvaluationService: kỷ luật, kết luận và điều kiện xếp loại (ADR-055)', () => {
  let h: Harness;
  const discipline = { kind: 'KY_LUAT' as const, decisionNo: '15-QĐ/ĐU', form: 'KHIEN_TRACH' as const, system: 'DANG' as const, reason: 'CONG_VU' as const };
  beforeEach(async () => {
    h = await buildEvaluation();
    await h.criteria.create(documentCriteria('2026-01-01'));
  });

  it('ghi nhận: chỉ chính cán bộ, cấp trên, người xem toàn bộ được xem; có nhật ký', async () => {
    const created = await h.ratingEventService.create(actorOf(null, 'office'), PEOPLE.staff, { ...discipline, effectiveDate: '2026-08-12', note: 'Vi phạm quy chế văn thư' });
    expect(h.audit.find((a) => a.action === 'evaluation.rating-event.create')?.details).toMatchObject({ kind: 'KY_LUAT', decisionNo: '15-QĐ/ĐU' });
    expect(await h.ratingEventService.list(actorOf('staff'), PEOPLE.staff, 2026, false)).toHaveLength(1);
    expect(await h.ratingEventService.list(actorOf('head'), PEOPLE.staff, 2026, false)).toHaveLength(1);
    expect(await h.ratingEventService.list(actorOf('head'), PEOPLE.staff, 2025, false)).toHaveLength(0);
    await expect(h.ratingEventService.list(actorOf('other'), PEOPLE.staff, 2026, false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(await h.ratingEventService.list(actorOf('other'), PEOPLE.staff, 2026, true)).toHaveLength(1);
    await h.ratingEventService.remove(actorOf(null, 'office'), created.id);
    expect(h.ratingEvents.rows).toHaveLength(0);
    expect(h.audit.some((a) => a.action === 'evaluation.rating-event.delete')).toBe(true);
  });

  it('kỳ có kỷ luật: mục I.1, I.2 phải Không đảm bảo; hồ sơ hiện cảnh báo', async () => {
    await h.ratingEventService.create(actorOf(null, 'office'), PEOPLE.staff, { ...discipline, effectiveDate: '2026-08-12' });
    const { evaluation } = await seedPlanned(h); // quý III/2026
    const t = await h.service.addTask(actorOf('head'), evaluation.id, { catalogItemCode: 'B.009', plannedQuantity: 1 });
    await h.service.recordResult(actorOf('staff'), t.id, { completedQuantity: 1 });
    await expect(h.service.selfSubmit(actorOf('staff'), evaluation.id, { general: marksFor('STAFF', ['I.2']) })).rejects.toThrow(/I.1 phải là Không đảm bảo.*15-QĐ\/ĐU/);
    expect(await h.service.selfSubmit(actorOf('staff'), evaluation.id, { general: marksFor('STAFF', ['I.1', 'I.2']) })).toMatchObject({ selfGeneralScore: 20 });

    const view = await h.service.getEvaluation(actorOf('head'), evaluation.id, false);
    expect(view.forcedItems.map((f) => f.code)).toEqual(['I.1', 'I.2']);
    expect(view.ratingEvents).toHaveLength(1);
    expect(view.warnings.join('|')).toMatch(/I.1, I.2 phải chấm Không đảm bảo/);
  });

  /** Sáu tháng đã phê duyệt, tổng 90 (xuất sắc theo điểm), và hồ sơ năm đã nộp. */
  async function yearReady() {
    for (let m = 1; m <= 6; m++) {
      const p = await h.service.createPeriod(actorOf('head'), { type: 'MONTH', year: 2026, number: m });
      const f = await h.repos.evaluations.create({ periodId: p.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
      await h.repos.evaluations.update(f.id, { status: 'APPROVED', generalScore: 25, resultScore: 65, totalScore: 90, rating: 'XUAT_SAC' });
    }
    const period = await h.service.createPeriod(actorOf('head'), { type: 'YEAR', year: 2026 });
    const year = await h.repos.evaluations.create({ periodId: period.id, personId: PEOPLE.staff, positionId: 'pos-staff', createdBy: null });
    await h.service.selfSubmit(actorOf('staff'), year.id, {});
    return year;
  }

  it('năm có điều kiện: thẩm định xếp "Không hoàn thành"; phê duyệt không có ngoại lệ thì giữ nguyên', async () => {
    await h.ratingEventService.create(actorOf(null, 'office'), PEOPLE.staff, { ...discipline, effectiveDate: '2026-11-03' });
    const year = await yearReady();
    const preview = await h.service.getEvaluation(actorOf('head'), year.id, false);
    expect(preview.yearConditions.map((c) => c.code)).toEqual(['KY_LUAT']);
    expect(preview.warnings.join('|')).toMatch(/Không hoàn thành nhiệm vụ.*39-QĐ\/TU/);

    const reviewed = await h.service.review(actorOf('head'), year.id, {});
    expect(reviewed.evaluation).toMatchObject({ totalScore: 90, rating: 'KHONG_HOAN_THANH' });
    expect(reviewed.evaluation.scoringParams).toMatchObject({ ratingByScore: 'XUAT_SAC', conditions: [expect.objectContaining({ code: 'KY_LUAT' })] });

    const approved = await h.service.approve(actorOf('deputy'), year.id, 'Đồng ý');
    expect(approved.evaluation).toMatchObject({ status: 'APPROVED', rating: 'KHONG_HOAN_THANH' });
  });

  it('người phê duyệt chọn ngoại lệ văn bản cho phép, có căn cứ: giữ mức theo điểm, ghi nhật ký', async () => {
    await h.ratingEventService.create(actorOf(null, 'office'), PEOPLE.staff, { ...discipline, effectiveDate: '2026-11-03' });
    const year = await yearReady();
    await h.service.review(actorOf('head'), year.id, {});
    await expect(h.service.approve(actorOf('deputy'), year.id, null, { code: 'TU_GIAC_KHAC_PHUC', note: ' ' })).rejects.toThrow(/căn cứ của ngoại lệ/);
    await expect(h.service.approve(actorOf('deputy'), year.id, null, { code: 'KHAC' as never, note: 'x' })).rejects.toThrow(/không hợp lệ/);
    const approved = await h.service.approve(actorOf('deputy'), year.id, null, { code: 'TU_GIAC_KHAC_PHUC', note: 'Tự báo cáo vi phạm, đã khắc phục xong hậu quả trong tháng 11' });
    expect(approved.evaluation).toMatchObject({ status: 'APPROVED', rating: 'XUAT_SAC' });
    expect(approved.evaluation.scoringParams).toMatchObject({ exception: { code: 'TU_GIAC_KHAC_PHUC' } });
    expect(h.audit.find((a) => a.action === 'evaluation.approve')?.details).toMatchObject({ conditions: ['KY_LUAT'], exception: { code: 'TU_GIAC_KHAC_PHUC' } });
  });

  it('không có điều kiện thì không được chọn ngoại lệ; xếp loại theo điểm như cũ', async () => {
    const year = await yearReady();
    const reviewed = await h.service.review(actorOf('head'), year.id, {});
    expect(reviewed.evaluation.rating).toBe('XUAT_SAC');
    await expect(h.service.approve(actorOf('deputy'), year.id, null, { code: 'TU_GIAC_KHAC_PHUC', note: 'x' })).rejects.toThrow(/Chỉ chọn ngoại lệ/);
  });

  it('điều kiện tự tính: trên 50% việc trong năm chưa hoàn thành (không giữ chức vụ)', async () => {
    const work = (n: number, done: number) => ({ assignmentId: `a${n}`, taskTitle: 'Việc', personId: PEOPLE.staff, positionId: null, catalogItemCode: 'B.009', plannedQuantity: 1, confirmedQuantity: done, lateCount: 0, reworkCount: 0, evidence: null });
    h.work.items = [work(1, 1), work(2, 0), work(3, 0), { ...work(4, 0), catalogItemCode: 'X.L2' }];
    const year = await yearReady();
    const view = await h.service.getEvaluation(actorOf('head'), year.id, false);
    // việc đột xuất không tính: 2/3 chưa hoàn thành
    expect(view.yearConditions).toEqual([expect.objectContaining({ code: 'NHIEM_VU_TREN_50', text: expect.stringMatching(/2\/3/) })]);
  });
});
