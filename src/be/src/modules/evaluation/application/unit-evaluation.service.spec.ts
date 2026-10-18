import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Clock } from '../../../common/clock.js';
import { FakeNotifier } from '../../../common/testing/fake-notifier.js';
import type { AuditService } from '../../security/index.js';
import { FakeClock, FakeOrg, FakeWork, InMemoryPeriods, InMemoryUnitComplaints } from './testing/in-memory.js';
import type { Actor } from './evaluation.service.js';
import type { Superior } from './evaluation.ports.js';
import type { NewUnitEvaluation, UnitEvaluationModel, UnitEvaluationPatch, UnitInfo } from './unit-evaluation.model.js';
import { UnitAxisRepository, UnitDirectory, UnitEvaluationRepository } from './unit-evaluation.ports.js';
import { FIXTURE_AXES } from './testing/axes-fixture.js';
import type { AxisDefinition } from './unit-axes.js';
import { UnitComplaintService } from './unit-complaint.service.js';
import type { ComplaintAccess } from './unit-complaint.service.js';
import { UnitEvaluationService } from './unit-evaluation.service.js';
import type { UnitAccess } from './unit-evaluation.service.js';

class MemUnitEvals extends UnitEvaluationRepository {
  rows: UnitEvaluationModel[] = [];
  private seq = 0;
  async findById(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? { ...r } : null;
  }
  async findByPeriodAndUnit(periodId: string, unitId: string) {
    const r = this.rows.find((x) => x.periodId === periodId && x.unitId === unitId);
    return r ? { ...r } : null;
  }
  async findByPeriod(periodId: string) {
    return this.rows.filter((x) => x.periodId === periodId).map((x) => ({ ...x }));
  }
  async create(d: NewUnitEvaluation) {
    const row: UnitEvaluationModel = {
      ...d,
      id: `ue-${++this.seq}`,
      status: 'PLANNED',
      selfGeneralScore: null,
      selfResultScore: null,
      selfComment: null,
      selfSubmittedAt: null,
      generalScore: null,
      resultScore: null,
      reviewComment: null,
      reviewerAccountId: null,
      reviewedAt: null,
      approverAccountId: null,
      approvedAt: null,
      approveComment: null,
      returnReason: null,
      totalScore: null,
      rating: null,
      metrics: null,
      selfAxisScores: null,
      axisScores: null,
    };
    this.rows.push(row);
    return { ...row };
  }
  async update(id: string, patch: UnitEvaluationPatch) {
    const row = this.rows.find((x) => x.id === id)!;
    Object.assign(row, patch);
    return { ...row };
  }
}

/** Cấu hình trục: bộ mặc định (`list`) rỗng nên các test cũ vẫn nhập hai số; test chấm theo trục đặt danh sách. */
class MemAxes extends UnitAxisRepository {
  list: AxisDefinition[] = [];
  /** Bộ riêng theo mã đơn vị (ADR-052). */
  own = new Map<string, AxisDefinition[]>();
  async findSet(unitId: string | null) {
    return (unitId === null ? this.list : (this.own.get(unitId) ?? [])).map((a) => ({ ...a }));
  }
  async unitsWithOwnSet() {
    return [...this.own.keys()];
  }
  async replaceSet(unitId: string | null, axes: readonly AxisDefinition[]) {
    if (unitId === null) this.list = axes.map((a) => ({ ...a }));
    else if (axes.length === 0) this.own.delete(unitId);
    else this.own.set(unitId, axes.map((a) => ({ ...a })));
  }
}

class MemUnits extends UnitDirectory {
  list: UnitInfo[] = [];
  async units() {
    return this.list.map((u) => ({ ...u }));
  }
}

const P = { boss: 'p-boss', deputy: 'p-deputy', head1: 'p-head1', head2: 'p-head2', staff1: 'p-staff1', staff2: 'p-staff2' } as const;
type Key = keyof typeof P;
const actor = (key: Key | null, account: string = key ?? 'rep'): Actor => ({ id: `acc-${account}`, username: account, personId: key ? P[key] : null });
const NONE: UnitAccess = { readAll: false, decideBan: false };
const REP: UnitAccess = { readAll: false, decideBan: true };
const ALL: UnitAccess = { readAll: true, decideBan: false };

const sup = (key: Key, level: number): Superior => ({ positionId: `pos-${key}`, level, personId: P[key] });

async function build() {
  const clock = new FakeClock();
  const periods = new InMemoryPeriods();
  const evals = new MemUnitEvals();
  const directory = new MemUnits();
  const org = new FakeOrg();
  const work = new FakeWork();
  const notifier = new FakeNotifier();
  const axes = new MemAxes();
  const complaintRows = new InMemoryUnitComplaints();
  const audit: { action: string; details?: Record<string, unknown> }[] = [];

  // Ban (boss, deputy) > ba phòng; trưởng phòng do deputy thẩm định, boss phê duyệt. Phòng 3 chưa có người đứng đầu.
  directory.list = [
    { id: 'u-ban', code: 'BAN', name: 'Ban', type: 'BAN', parentId: null, headPersonId: P.boss, memberPersonIds: [P.boss, P.deputy] },
    { id: 'u-p1', code: 'P1', name: 'Phòng 1', type: 'PHONG', parentId: 'u-ban', headPersonId: P.head1, memberPersonIds: [P.head1, P.staff1] },
    { id: 'u-p2', code: 'P2', name: 'Phòng 2', type: 'PHONG', parentId: 'u-ban', headPersonId: P.head2, memberPersonIds: [P.head2, P.staff2] },
    { id: 'u-p3', code: 'P3', name: 'Phòng 3', type: 'PHONG', parentId: 'u-ban', headPersonId: null, memberPersonIds: [] },
  ];
  for (const h of ['head1', 'head2'] as const) org.chains.set(P[h], [sup('deputy', 2), sup('boss', 1)]);
  org.chains.set(P.deputy, [sup('boss', 1)]);
  org.chains.set(P.boss, []);

  const service = new UnitEvaluationService(
    periods,
    evals,
    directory,
    org,
    work,
    clock as Clock,
    { record: async (e: { action: string }) => void audit.push(e) } as unknown as AuditService,
    notifier,
    axes,
    complaintRows,
  );
  const complaints = new UnitComplaintService(complaintRows, service, clock as Clock, { record: async (e: { action: string }) => void audit.push(e) } as unknown as AuditService, notifier);
  const year = await periods.create({ type: 'YEAR', year: 2026, number: null, label: '2026', startDate: '2026-01-01', endDate: '2026-12-31', catalogVersionId: 'v', createdBy: null });
  const quarter = await periods.create({ type: 'QUARTER', year: 2026, number: 3, label: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30', catalogVersionId: 'v', createdBy: null });
  return { service, evals, directory, work, notifier, audit, periods, year, quarter, axes, complaints, complaintRows };
}
type H = Awaited<ReturnType<typeof build>>;

const done = (personId: string, planned = 10, confirmed = 10, late = 0) => ({
  assignmentId: `${personId}-${planned}-${confirmed}-${late}`,
  taskTitle: 't',
  personId,
  catalogItemCode: 'B.009',
  plannedQuantity: planned,
  confirmedQuantity: confirmed,
  lateCount: late,
  reworkCount: 0,
  evidence: null,
});

const idOf = async (h: H, unitId: string) => (await h.evals.findByPeriodAndUnit(h.year.id, unitId))!.id;
const SCORE = { generalScore: 25, resultScore: 60 };

/** Một phòng chạy hết luồng đến khi được phê duyệt. */
async function approvePhong(h: H, unitId: string, head: Key, scores = SCORE) {
  const id = await idOf(h, unitId);
  await h.service.selfSubmit(actor(head), id, scores);
  await h.service.review(actor('deputy'), id, scores, NONE);
  await h.service.approve(actor('boss'), id, 'Đồng ý', NONE);
  return id;
}

describe('UnitEvaluationService (ADR-030)', () => {
  let h: H;
  beforeEach(async () => {
    h = await build();
    await h.service.generate(actor('boss'), h.year.id);
  });

  it('tạo hồ sơ cho mọi đơn vị, chạy lại không tạo trùng, chỉ kỳ năm', async () => {
    expect(h.evals.rows).toHaveLength(4);
    expect(await h.service.generate(actor('boss'), h.year.id)).toEqual({ created: 0, existing: 4 });
    await expect(h.service.generate(actor('boss'), h.quarter.id)).rejects.toThrow('theo năm');
    expect(h.audit.map((a) => a.action)).toContain('unit-evaluation.generate');
  });

  it('phòng đi hết luồng: người đứng đầu tự chấm, cấp trên thẩm định, cấp trên nữa công nhận; điểm và xếp loại được chốt', async () => {
    const id = await idOf(h, 'u-p1');
    await h.service.selfSubmit(actor('head1'), id, { ...SCORE, comment: 'Tự đánh giá' });
    expect(h.notifier.of('EVAL_SELF_SUBMITTED')).toEqual([expect.objectContaining({ to: [P.deputy], link: `/unit-evaluations/${id}` })]);

    const reviewed = await h.service.review(actor('deputy'), id, { generalScore: 26, resultScore: 66 }, NONE);
    expect(reviewed.evaluation).toMatchObject({ status: 'REVIEWED', totalScore: 92, rating: 'XUAT_SAC', reviewerAccountId: 'acc-deputy' });
    expect(h.notifier.of('EVAL_REVIEWED')).toEqual([expect.objectContaining({ to: [P.boss] })]);

    const approved = await h.service.approve(actor('boss'), id, 'Công nhận', NONE);
    expect(approved.evaluation).toMatchObject({ status: 'APPROVED', approverAccountId: 'acc-boss' });
    expect(h.notifier.of('EVAL_APPROVED')).toEqual([expect.objectContaining({ to: [P.head1, P.staff1] })]);
    expect(JSON.stringify(h.notifier.sent)).not.toMatch(/92|Xuất sắc|XUAT_SAC/);
    await expect(h.service.approve(actor('boss'), id, null, NONE)).rejects.toBeInstanceOf(ConflictException);
    expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['unit-evaluation.self-submit', 'unit-evaluation.review', 'unit-evaluation.approve']));
  });

  it('chỉ đúng người được làm từng bước', async () => {
    const id = await idOf(h, 'u-p1');
    await expect(h.service.selfSubmit(actor('staff1'), id, SCORE)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.selfSubmit(actor('head2'), id, SCORE)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.selfSubmit(actor(null), id, SCORE)).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.selfSubmit(actor('head1'), id, SCORE);
    await expect(h.service.review(actor('head1'), id, SCORE, NONE)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.review(actor('boss'), id, SCORE, NONE)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.review(actor(null), id, SCORE, REP)).rejects.toBeInstanceOf(ForbiddenException);
    await h.service.review(actor('deputy'), id, SCORE, NONE);
    await expect(h.service.approve(actor('deputy'), id, null, NONE)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.approve(actor('head1'), id, null, NONE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('đơn vị chưa có người đứng đầu thì chưa tự đánh giá được', async () => {
    await expect(h.service.selfSubmit(actor('head1'), await idOf(h, 'u-p3'), SCORE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('điểm ngoài khoảng bị từ chối, thao tác lỗi không để lại thông báo', async () => {
    const id = await idOf(h, 'u-p1');
    await expect(h.service.selfSubmit(actor('head1'), id, { generalScore: 31, resultScore: 10 })).rejects.toThrow('0 đến 30');
    await expect(h.service.selfSubmit(actor('head1'), id, { generalScore: 10, resultScore: 71 })).rejects.toThrow('0 đến 70');
    expect(h.notifier.sent).toEqual([]);
  });

  it('trả lại xóa điểm đã thẩm định và báo người đứng đầu, không nêu lý do', async () => {
    const id = await idOf(h, 'u-p1');
    await h.service.selfSubmit(actor('head1'), id, SCORE);
    await h.service.review(actor('deputy'), id, SCORE, NONE);
    await expect(h.service.returnEvaluation(actor('deputy'), id, 'Chưa đủ', NONE)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.service.returnEvaluation(actor('boss'), id, 'ab', NONE)).rejects.toThrow('lý do');
    const back = await h.service.returnEvaluation(actor('boss'), id, 'Cần bổ sung minh chứng', NONE);
    expect(back).toMatchObject({ status: 'PLANNED', totalScore: null, rating: null, metrics: null, returnReason: 'Cần bổ sung minh chứng' });
    expect(h.notifier.of('EVAL_RETURNED')).toEqual([expect.objectContaining({ to: [P.head1] })]);
    expect(JSON.stringify(h.notifier.sent)).not.toContain('minh chứng');
  });

  describe('hồ sơ của Ban', () => {
    it('phải phê duyệt xong mọi đơn vị cấp dưới mới thẩm định được (cấp dưới trước cấp trên)', async () => {
      const ban = await idOf(h, 'u-ban');
      await h.service.selfSubmit(actor('boss'), ban, SCORE);
      await approvePhong(h, 'u-p1', 'head1');
      await expect(h.service.review(actor(null), ban, SCORE, REP)).rejects.toThrow(/Phòng 2.*Phòng 3/);
      await approvePhong(h, 'u-p2', 'head2');
      // Phòng 3 chưa có người đứng đầu nên không phê duyệt được: Ban vẫn bị chặn.
      await expect(h.service.review(actor(null), ban, SCORE, REP)).rejects.toThrow('Phòng 3');
    });

    it('chỉ đại diện Ban Thường vụ thẩm định, phê duyệt; người đứng đầu Ban không tự duyệt cho mình', async () => {
      h.directory.list = h.directory.list.filter((u) => u.id !== 'u-p3');
      const ban = await idOf(h, 'u-ban');
      await approvePhong(h, 'u-p1', 'head1');
      await approvePhong(h, 'u-p2', 'head2');
      await h.service.selfSubmit(actor('boss'), ban, SCORE);
      expect(h.notifier.sent.filter((n) => n.link?.endsWith(ban))).toEqual([]);

      await expect(h.service.review(actor('deputy'), ban, SCORE, NONE)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.review(actor('boss'), ban, SCORE, ALL)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(h.service.review(actor('boss'), ban, SCORE, REP)).rejects.toBeInstanceOf(ForbiddenException);

      const reviewed = await h.service.review(actor(null, 'thuongvu'), ban, { generalScore: 27, resultScore: 65 }, REP);
      expect(reviewed.evaluation).toMatchObject({ status: 'REVIEWED', totalScore: 92, rating: 'XUAT_SAC' });
      const approved = await h.service.approve(actor(null, 'thuongvu'), ban, 'Ban Thường vụ công nhận', REP);
      expect(approved.evaluation.status).toBe('APPROVED');
      expect(approved.evaluation.approverAccountId).toBe('acc-thuongvu');
    });
  });

  describe('xem hồ sơ', () => {
    it('người đứng đầu và các cấp trên thấy, người khác không', async () => {
      expect((await h.service.list(actor('head1'), h.year.id, NONE)).map((v) => v.unit.code)).toEqual(['P1']);
      expect((await h.service.list(actor('deputy'), h.year.id, NONE)).map((v) => v.unit.code).sort()).toEqual(['P1', 'P2']);
      expect(await h.service.list(actor('staff1'), h.year.id, NONE)).toEqual([]);
      expect((await h.service.list(actor(null), h.year.id, ALL)).map((v) => v.unit.code)).toEqual(['BAN', 'P1', 'P2', 'P3']);
      expect((await h.service.list(actor(null), h.year.id, REP)).map((v) => v.unit.code)).toEqual(['BAN']);
      await expect(h.service.get(actor('staff1'), await idOf(h, 'u-p1'), NONE)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('thành viên của phòng chỉ xem được kết quả sau khi phê duyệt, không thấy nhận xét hay cảnh báo; phòng khác vẫn không thấy', async () => {
      const id = await idOf(h, 'u-p1');
      await h.service.selfSubmit(actor('head1'), id, { ...SCORE, comment: 'Nhận xét nội bộ' });
      await h.service.review(actor('deputy'), id, { ...SCORE, comment: 'Thẩm định nội bộ' }, NONE);
      expect(await h.service.list(actor('staff1'), h.year.id, NONE)).toEqual([]);

      await h.service.approve(actor('boss'), id, 'Ý kiến công nhận', NONE);
      const [view] = await h.service.list(actor('staff1'), h.year.id, NONE);
      expect(view.unit.code).toBe('P1');
      expect(view.evaluation).toMatchObject({ status: 'APPROVED', totalScore: 85, rating: 'HOAN_THANH_TOT', selfComment: null, reviewComment: null, approveComment: null });
      expect(view.warnings).toEqual([]);
      expect((await h.service.get(actor('staff1'), id, NONE)).evaluation.reviewComment).toBeNull();
      // Người đứng đầu vẫn xem đủ.
      expect((await h.service.get(actor('head1'), id, NONE)).evaluation.reviewComment).toBe('Thẩm định nội bộ');
      // Cán bộ phòng khác không thấy.
      await expect(h.service.get(actor('staff2'), id, NONE)).rejects.toBeInstanceOf(NotFoundException);
      expect((await h.service.list(actor('staff2'), h.year.id, NONE)).map((v) => v.unit.code)).toEqual([]);
    });
  });

  describe('số liệu tham chiếu và cảnh báo', () => {
    it('gộp việc của cán bộ vào đơn vị; Ban gồm cả các phòng', async () => {
      h.work.items = [done(P.staff1), done(P.staff1, 10, 12), done(P.staff2, 10, 4), done(P.boss)];
      const views = await h.service.list(actor(null), h.year.id, ALL);
      const by = Object.fromEntries(views.map((v) => [v.unit.code, v.metrics]));
      expect(by.P1).toMatchObject({ works: 2, completed: 2, onTime: 2, exceeded: 1 });
      expect(by.P2).toMatchObject({ works: 1, completed: 0 });
      expect(by.BAN.works).toBe(4);
      expect(by.P3.works).toBe(0);
    });

    it('xuất sắc mà số liệu chưa đủ thì có cảnh báo; số liệu chụp lúc thẩm định giữ nguyên sau đó', async () => {
      h.work.items = [done(P.staff1), done(P.staff1, 10, 8, 1)];
      const id = await idOf(h, 'u-p1');
      await h.service.selfSubmit(actor('head1'), id, { generalScore: 28, resultScore: 66 });
      const before = await h.service.get(actor('deputy'), id, NONE);
      expect(before.proposedRating).toBe('XUAT_SAC');
      expect(before.warnings.join('|')).toMatch(/100% nhiệm vụ hoàn thành đúng hạn/);

      const reviewed = await h.service.review(actor('deputy'), id, { generalScore: 28, resultScore: 66 }, NONE);
      expect(reviewed.evaluation.metrics).toMatchObject({ works: 2, completed: 1 });
      h.work.items = [];
      expect((await h.service.get(actor('deputy'), id, NONE)).metrics.works).toBe(2);
    });

    it('cảnh báo khi xuất sắc vượt hạn mức so với số đơn vị hoàn thành tốt', async () => {
      await approvePhong(h, 'u-p1', 'head1', { generalScore: 28, resultScore: 66 });
      const id = await idOf(h, 'u-p2');
      await h.service.selfSubmit(actor('head2'), id, { generalScore: 28, resultScore: 66 });
      const view = await h.service.review(actor('deputy'), id, { generalScore: 28, resultScore: 66 }, NONE);
      expect(view.warnings.join('|')).toMatch(/2 đơn vị xuất sắc trên 0 đơn vị hoàn thành tốt/);
    });

    it('người thẩm định thấy cảnh báo hạn mức ngay từ mức tự đề xuất, trước khi chấm điểm', async () => {
      const id = await idOf(h, 'u-p1');
      await h.service.selfSubmit(actor('head1'), id, { generalScore: 28, resultScore: 66 });
      const view = await h.service.get(actor('deputy'), id, NONE);
      expect(view.evaluation.rating).toBeNull();
      expect(view.warnings.join('|')).toMatch(/1 đơn vị xuất sắc trên 0 đơn vị hoàn thành tốt/);
    });

    it('hạn mức của phòng không tính hồ sơ của Ban và ngược lại', async () => {
      const ban = await idOf(h, 'u-ban');
      await h.service.selfSubmit(actor('boss'), ban, { generalScore: 28, resultScore: 66 });
      // Phòng 1 đã xuất sắc nhưng thuộc phạm vi khác: Ban chỉ đếm chính mình
      await approvePhong(h, 'u-p1', 'head1', { generalScore: 28, resultScore: 66 });
      const view = await h.service.get(actor(null), ban, REP);
      expect(view.warnings.join('|')).toMatch(/1 đơn vị xuất sắc trên 0 đơn vị hoàn thành tốt/);
    });
  });

  it('kỳ đã đóng thì không thao tác', async () => {
    await h.periods.close(h.year.id);
    await expect(h.service.selfSubmit(actor('head1'), await idOf(h, 'u-p1'), SCORE)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('UnitEvaluationService: chấm theo trục cấu hình (ADR-036)', () => {
  let h: H;
  const axisInput = (value: (a: AxisDefinition) => number) => FIXTURE_AXES.map((a) => ({ code: a.code, score: value(a) }));
  const at80 = axisInput((a) => a.maxPoints * 0.8); // chung 24, kết quả 56

  beforeEach(async () => {
    h = await build();
    h.axes.list = FIXTURE_AXES.map((a) => ({ ...a }));
    await h.service.generate(actor('boss'), h.year.id);
  });

  it('tự chấm và thẩm định theo trục: điểm nhóm là tổng các trục, lưu ảnh chụp trục', async () => {
    const id = await idOf(h, 'u-p1');
    await h.service.selfSubmit(actor('head1'), id, { axes: at80 });
    const self = (await h.evals.findById(id))!;
    expect(self).toMatchObject({ selfGeneralScore: 24, selfResultScore: 56 });
    expect(self.selfAxisScores).toHaveLength(9);

    const view = await h.service.review(actor('deputy'), id, { axes: axisInput((a) => (a.code === 'T6' ? 4 : a.maxPoints * 0.9)), comment: 'Tốt' }, NONE);
    expect(view.evaluation).toMatchObject({ generalScore: 27, resultScore: 62.5, totalScore: 89.5, rating: 'HOAN_THANH_TOT' });
    expect(view.evaluation.axisScores?.find((a) => a.code === 'T1')).toMatchObject({ kind: 'RESULT', max: 15, score: 13.5 });
    expect(h.audit.find((a) => a.action === 'unit-evaluation.review')?.details).toMatchObject({ generalScore: 27, resultScore: 62.5 });
    expect(view.axes.map((a) => a.code)).toEqual(['G1', 'G2', 'G3', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
  });

  it('thiếu trục, vượt điểm tối đa của trục, hoặc chỉ gửi hai số khi có trục đang bật thì bị từ chối', async () => {
    const id = await idOf(h, 'u-p1');
    await expect(h.service.selfSubmit(actor('head1'), id, { axes: at80.slice(1) })).rejects.toThrow(/Thiếu điểm trục G1/);
    await expect(h.service.selfSubmit(actor('head1'), id, { axes: at80.map((a) => (a.code === 'T6' ? { ...a, score: 6 } : a)) })).rejects.toThrow(/trục T6 phải từ 0 đến 5/);
    await expect(h.service.selfSubmit(actor('head1'), id, { generalScore: 25, resultScore: 60 })).rejects.toBeInstanceOf(BadRequestException);
    expect((await h.evals.findById(id))!.status).toBe('PLANNED');
  });

  it('gợi ý T2 theo tỷ lệ việc hoàn thành; thành viên đơn vị xem kết quả không thấy gợi ý và điểm tự chấm', async () => {
    h.work.items = [done(P.staff1, 10, 10), done(P.staff1, 10, 5), done(P.head1, 4, 4), done(P.head1, 4, 4)];
    const id = await idOf(h, 'u-p1');
    await h.service.selfSubmit(actor('head1'), id, { axes: at80 });
    expect((await h.service.get(actor('deputy'), id, NONE)).suggested).toEqual({ T2: 15 });

    await h.service.review(actor('deputy'), id, { axes: at80 }, NONE);
    await h.service.approve(actor('boss'), id, 'Đồng ý', NONE);
    const member = await h.service.get(actor('staff1'), id, NONE);
    expect(member.suggested).toEqual({});
    expect(member.evaluation.selfAxisScores).toBeNull();
    expect(member.evaluation.axisScores).toHaveLength(9);
  });

  it('trả lại hồ sơ xóa điểm trục của người thẩm định, giữ điểm trục tự chấm', async () => {
    const id = await idOf(h, 'u-p1');
    await h.service.selfSubmit(actor('head1'), id, { axes: at80 });
    await h.service.review(actor('deputy'), id, { axes: at80 }, NONE);
    await h.service.returnEvaluation(actor('boss'), id, 'Chấm lại trục T3', NONE);
    const row = (await h.evals.findById(id))!;
    expect(row.axisScores).toBeNull();
    expect(row.selfAxisScores).toHaveLength(9);
  });

  it('chỉ một nhóm có trục thì nhóm còn lại nhập một số', async () => {
    h.axes.list = h.axes.list.map((a) => (a.kind === 'GENERAL' ? { ...a, active: false } : a));
    const id = await idOf(h, 'u-p1');
    await h.service.selfSubmit(actor('head1'), id, { generalScore: 26, axes: at80.filter((a) => a.code.startsWith('T')) });
    expect(await h.evals.findById(id)).toMatchObject({ selfGeneralScore: 26, selfResultScore: 56 });
  });

  describe('cấu hình trục', () => {
    it('Văn phòng sửa cấu hình hợp lệ và có nhật ký; tổng sai bị từ chối', async () => {
      const next = FIXTURE_AXES.map((a) => (a.code === 'T6' ? { ...a, maxPoints: 4 } : a.code === 'T1' ? { ...a, maxPoints: 16 } : a));
      expect((await h.service.replaceAxes(actor('boss'), next)).find((a) => a.code === 'T1')?.maxPoints).toBe(16);
      expect(h.audit.map((a) => a.action)).toContain('unit-evaluation.axes.update');
      await expect(h.service.replaceAxes(actor('boss'), FIXTURE_AXES.map((a) => (a.code === 'T6' ? { ...a, maxPoints: 9 } : a)))).rejects.toThrow(/phải bằng 70/);
      expect((await h.axes.findSet(null)).find((a) => a.code === 'T6')?.maxPoints).toBe(4); // cấu hình lỗi không ghi đè
    });

    it('không sửa được khi còn hồ sơ chờ thẩm định hoặc phê duyệt, sửa được sau khi hoàn tất', async () => {
      const id = await idOf(h, 'u-p1');
      await h.service.selfSubmit(actor('head1'), id, { axes: at80 });
      await expect(h.service.replaceAxes(actor('boss'), FIXTURE_AXES)).rejects.toBeInstanceOf(ConflictException);
      await h.service.returnEvaluation(actor('deputy'), id, 'Chấm lại sau khi đổi trục', NONE);
      await expect(h.service.replaceAxes(actor('boss'), FIXTURE_AXES)).resolves.toHaveLength(9);
    });

    it('hồ sơ đã phê duyệt giữ ảnh chụp trục dù cấu hình đổi sau đó', async () => {
      const id = await idOf(h, 'u-p1');
      await h.service.selfSubmit(actor('head1'), id, { axes: at80 });
      await h.service.review(actor('deputy'), id, { axes: at80 }, NONE);
      await h.service.approve(actor('boss'), id, 'Đồng ý', NONE);
      await h.service.replaceAxes(actor('boss'), FIXTURE_AXES.map((a) => (a.code === 'T6' ? { ...a, maxPoints: 4 } : a.code === 'T1' ? { ...a, maxPoints: 16 } : a)));
      const row = (await h.evals.findById(id))!;
      expect(row.axisScores?.find((a) => a.code === 'T6')).toMatchObject({ max: 5, score: 4 });
      expect(row.resultScore).toBe(56);
    });
  });
});

describe('UnitEvaluationService: bộ trục riêng của từng đơn vị (ADR-052)', () => {
  let h: H;
  // Bộ riêng của Phòng 1: hai trục chung 15 + 15 và hai trục kết quả 40 + 30, mã khác hẳn bộ mặc định.
  const OWN: AxisDefinition[] = [
    { code: 'X1', name: 'Chung một', kind: 'GENERAL', maxPoints: 15, sortOrder: 1, autoMetric: null, active: true },
    { code: 'X2', name: 'Chung hai', kind: 'GENERAL', maxPoints: 15, sortOrder: 2, autoMetric: null, active: true },
    { code: 'Y1', name: 'Kết quả chính', kind: 'RESULT', maxPoints: 40, sortOrder: 3, autoMetric: 'COMPLETED_SHARE', active: true },
    { code: 'Y2', name: 'Kết quả phụ', kind: 'RESULT', maxPoints: 30, sortOrder: 4, autoMetric: null, active: true },
  ];
  const full = (defs: readonly AxisDefinition[], ratio = 1) => defs.map((a) => ({ code: a.code, score: a.maxPoints * ratio }));

  beforeEach(async () => {
    h = await build();
    h.axes.list = FIXTURE_AXES.map((a) => ({ ...a }));
    await h.service.generate(actor('boss'), h.year.id);
  });

  it('đơn vị có bộ riêng chấm theo bộ riêng; đơn vị khác vẫn theo bộ mặc định', async () => {
    await h.service.replaceAxes(actor('boss'), OWN, 'u-p1');
    const p1 = await idOf(h, 'u-p1');
    const p2 = await idOf(h, 'u-p2');
    await expect(h.service.selfSubmit(actor('head1'), p1, { axes: full(FIXTURE_AXES) })).rejects.toThrow(/không có hoặc đã tắt/);
    await h.service.selfSubmit(actor('head1'), p1, { axes: full(OWN, 0.5) });
    expect(await h.evals.findById(p1)).toMatchObject({ selfGeneralScore: 15, selfResultScore: 35 });
    await h.service.selfSubmit(actor('head2'), p2, { axes: full(FIXTURE_AXES, 0.5) });
    expect((await h.evals.findById(p2))!.selfAxisScores).toHaveLength(9);

    expect((await h.service.get(actor('deputy'), p1, NONE)).axes.map((a) => a.code)).toEqual(['X1', 'X2', 'Y1', 'Y2']);
    expect((await h.service.get(actor('deputy'), p2, NONE)).axes).toHaveLength(9);
    expect((await h.service.axes('u-p1')).map((a) => a.code)).toEqual(['X1', 'X2', 'Y1', 'Y2']);
    expect(await h.service.axes('u-p2')).toHaveLength(9);
  });

  it('danh sách bộ trục: bộ mặc định trước, đơn vị cha trước đơn vị con, đánh dấu đơn vị có bộ riêng', async () => {
    await h.service.replaceAxes(actor('boss'), OWN, 'u-p1');
    const sets = await h.service.axisSets();
    expect(sets.map((s) => [s.unitCode, s.own, s.axes.length])).toEqual([
      [null, true, 9],
      ['BAN', false, 9],
      ['P1', true, 4],
      ['P2', false, 9],
      ['P3', false, 9],
    ]);
  });

  it('hồ sơ đang chờ chỉ chặn sửa bộ trục mà hồ sơ đó dùng', async () => {
    await h.service.replaceAxes(actor('boss'), OWN, 'u-p1');
    await h.service.selfSubmit(actor('head2'), await idOf(h, 'u-p2'), { axes: full(FIXTURE_AXES) }); // P2 dùng bộ mặc định
    await expect(h.service.replaceAxes(actor('boss'), FIXTURE_AXES)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.replaceAxes(actor('boss'), OWN.map((a) => ({ ...a, name: `${a.name} sửa` })), 'u-p1')).resolves.toHaveLength(4);

    await h.service.selfSubmit(actor('head1'), await idOf(h, 'u-p1'), { axes: full(OWN) });
    await expect(h.service.replaceAxes(actor('boss'), OWN, 'u-p1')).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.resetAxes(actor('boss'), 'u-p1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('bỏ bộ riêng thì quay về bộ mặc định; có nhật ký; đơn vị lạ, bộ rỗng, bỏ khi chưa có đều bị từ chối', async () => {
    await h.service.replaceAxes(actor('boss'), OWN, 'u-p1');
    expect((await h.service.resetAxes(actor('boss'), 'u-p1')).map((a) => a.code)).toEqual(FIXTURE_AXES.map((a) => a.code));
    expect(await h.service.axes('u-p1')).toHaveLength(9);
    expect(h.audit.filter((a) => a.action.startsWith('unit-evaluation.axes')).map((a) => [a.action, a.details?.set])).toEqual([
      ['unit-evaluation.axes.update', 'P1'],
      ['unit-evaluation.axes.reset', 'P1'],
    ]);

    await expect(h.service.resetAxes(actor('boss'), 'u-p1')).rejects.toBeInstanceOf(ConflictException);
    await expect(h.service.replaceAxes(actor('boss'), OWN, 'u-khong-co')).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.axes('u-khong-co')).rejects.toBeInstanceOf(NotFoundException);
    await expect(h.service.replaceAxes(actor('boss'), [], 'u-p2')).rejects.toThrow(/ít nhất một trục/);
    await expect(h.service.replaceAxes(actor('boss'), OWN.map((a) => (a.code === 'Y2' ? { ...a, maxPoints: 20 } : a)), 'u-p2')).rejects.toThrow(/phải bằng 70/);
  });
});

const OFFICE: ComplaintAccess = { readAll: true, decideBan: false, manage: true };
const BODY = { kind: 'PHAN_ANH' as const, content: 'Phản ánh về việc phân công không công bằng trong phòng' };

describe('khiếu nại, phản ánh trước khi công nhận (ADR-038)', () => {
  let h: H;
  beforeEach(async () => {
    h = await build();
    await h.service.generate(actor('boss'), h.year.id);
  });

  const toReviewed = async (head: Key = 'head1', unit = 'u-p1') => {
    const id = await idOf(h, unit);
    await h.service.selfSubmit(actor(head), id, SCORE);
    await h.service.review(actor('deputy'), id, SCORE, NONE);
    return id;
  };

  it('còn khiếu nại chưa kết luận thì chưa công nhận; kết luận xong công nhận được', async () => {
    const id = await toReviewed();
    const c = await h.complaints.create(actor('boss'), id, BODY, OFFICE);
    expect(c).toMatchObject({ status: 'RECEIVED', unitId: 'u-p1' });
    await expect(h.service.approve(actor('boss'), id, null, NONE)).rejects.toThrow(/Điều 9\.2\.a/);

    await h.complaints.direct(actor('boss'), c.id, { assignee: 'Tổ xác minh của Ban' }, NONE_COMPLAINT);
    await expect(h.service.approve(actor('boss'), id, null, NONE)).rejects.toBeInstanceOf(ConflictException);

    const closed = await h.complaints.close(actor('boss'), c.id, { outcome: 'UNFOUNDED', conclusion: 'Đã xác minh, nội dung phản ánh không đúng' }, NONE_COMPLAINT);
    expect(closed).toMatchObject({ status: 'CLOSED', outcome: 'UNFOUNDED' });
    expect((await h.service.approve(actor('boss'), id, null, NONE)).evaluation.status).toBe('APPROVED');
    expect(h.audit.map((a) => a.action)).toEqual(expect.arrayContaining(['unit-complaint.create', 'unit-complaint.verify', 'unit-complaint.close']));
  });

  it('kết luận "đúng" vẫn công nhận được, không tự hạ xếp loại', async () => {
    const id = await toReviewed();
    const c = await h.complaints.create(actor('boss'), id, BODY, OFFICE);
    await h.complaints.direct(actor('boss'), c.id, { assignee: 'Tổ xác minh' }, NONE_COMPLAINT);
    await h.complaints.close(actor('boss'), c.id, { outcome: 'SUBSTANTIATED', conclusion: 'Xác minh đúng, đã nhắc nhở' }, NONE_COMPLAINT);
    const done = await h.service.approve(actor('boss'), id, 'Có xét kết luận xác minh', NONE);
    expect(done.evaluation).toMatchObject({ status: 'APPROVED', rating: 'HOAN_THANH_TOT' });
  });

  it('chỉ Văn phòng ghi nhận; chỉ người công nhận chỉ đạo xác minh và kết luận; phải chỉ đạo rồi mới kết luận', async () => {
    const id = await toReviewed();
    await expect(h.complaints.create(actor('boss'), id, BODY, NONE_COMPLAINT)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.complaints.create(actor('boss'), id, { ...BODY, content: 'ngắn' }, OFFICE)).rejects.toBeInstanceOf(BadRequestException);
    const c = await h.complaints.create(actor('boss'), id, BODY, OFFICE);
    // Người thẩm định và Văn phòng không kết luận được.
    await expect(h.complaints.direct(actor('deputy'), c.id, { assignee: 'Tổ xác minh' }, NONE_COMPLAINT)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.complaints.direct(actor('boss'), c.id, { assignee: 'x' }, NONE_COMPLAINT)).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.complaints.close(actor('boss'), c.id, { outcome: 'UNFOUNDED', conclusion: 'Không đúng sự thật' }, NONE_COMPLAINT)).rejects.toBeInstanceOf(ConflictException);
    await h.complaints.direct(actor('boss'), c.id, { assignee: 'Tổ xác minh' }, NONE_COMPLAINT);
    await expect(h.complaints.direct(actor('boss'), c.id, { assignee: 'Tổ xác minh' }, NONE_COMPLAINT)).rejects.toBeInstanceOf(ConflictException);
    await expect(h.complaints.close(actor('boss'), c.id, { outcome: 'UNFOUNDED', conclusion: 'ngắn' }, NONE_COMPLAINT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nội dung chỉ Văn phòng, người thẩm định, người công nhận xem; người đứng đầu và thành viên không thấy', async () => {
    const id = await toReviewed();
    await h.complaints.create(actor('boss'), id, BODY, OFFICE);
    expect(await h.complaints.list(actor('deputy'), id, NONE_COMPLAINT)).toHaveLength(1);
    expect(await h.complaints.list(actor('boss'), id, NONE_COMPLAINT)).toHaveLength(1);
    expect(await h.complaints.list(actor('head2'), id, OFFICE)).toHaveLength(1);
    await expect(h.complaints.list(actor('head1'), id, NONE_COMPLAINT)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(h.complaints.list(actor('staff1'), id, NONE_COMPLAINT)).rejects.toBeInstanceOf(ForbiddenException);

    // Hồ sơ hiện cảnh báo và số khiếu nại cho cấp trên, nhưng người đứng đầu đơn vị không thấy.
    const forDeputy = await h.service.get(actor('deputy'), id, NONE);
    expect(forDeputy.openComplaints).toBe(1);
    expect(forDeputy.warnings.join('\n')).toMatch(/Điều 9\.2\.a/);
    const forHead = await h.service.get(actor('head1'), id, NONE);
    expect(forHead.openComplaints).toBe(0);
    expect(forHead.warnings.join('\n')).not.toMatch(/Điều 9\.2\.a/);
  });

  it('thông báo cho người công nhận mà không nêu nội dung; khiếu nại của phòng khác không chặn phòng này', async () => {
    const id = await toReviewed();
    await toReviewed('head2', 'u-p2');
    await h.complaints.create(actor('boss'), id, BODY, OFFICE);
    const sent = h.notifier.of('COMPLAINT_RECEIVED');
    expect(sent).toEqual([expect.objectContaining({ to: [P.boss] })]);
    expect(JSON.stringify(sent)).not.toMatch(/phân công không công bằng/);
    const other = await idOf(h, 'u-p2');
    expect((await h.service.approve(actor('boss'), other, null, NONE)).evaluation.status).toBe('APPROVED');
  });

  it('hồ sơ của Ban do đại diện Ban Thường vụ chỉ đạo xác minh và kết luận', async () => {
    const id = await idOf(h, 'u-ban');
    const REP_C: ComplaintAccess = { readAll: false, decideBan: true, manage: false };
    const c = await h.complaints.create(actor('boss'), id, { ...BODY, kind: 'MAT_DOAN_KET' }, OFFICE);
    // Người đứng đầu Ban không tự xác minh về Ban của mình.
    await expect(h.complaints.direct(actor('boss'), c.id, { assignee: 'Tổ xác minh' }, REP_C)).rejects.toBeInstanceOf(ForbiddenException);
    await h.complaints.direct(actor(null), c.id, { assignee: 'Ủy ban Kiểm tra' }, REP_C);
    expect((await h.complaintRows.findById(c.id))?.status).toBe('VERIFYING');
  });
});

const NONE_COMPLAINT: ComplaintAccess = { readAll: false, decideBan: false, manage: false };
