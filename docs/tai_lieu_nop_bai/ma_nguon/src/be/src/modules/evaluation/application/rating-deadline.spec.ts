import { BadRequestException } from '@nestjs/common';
import { buildEvaluation, PEOPLE } from './testing/in-memory.js';
import { deadlineStatus, deadlineWarning, todayVn, validateDeadline } from './rating-deadline.js';

const year = (ratingDeadline: string | null = null) => ({ type: 'YEAR' as const, year: 2026, ratingDeadline });
const at = (iso: string) => new Date(`${iso}T05:00:00Z`);

describe('hạn hoàn thành đánh giá năm (ADR-038)', () => {
  it('hạn mặc định 15/12; kỳ tháng, quý không có hạn', () => {
    expect(deadlineStatus(year(), at('2026-10-03'))).toMatchObject({ date: '2026-12-15', extended: false, daysLeft: 73, overdue: false, reminder: false });
    expect(deadlineStatus({ type: 'MONTH', year: 2026, ratingDeadline: null }, at('2026-10-03'))).toBeNull();
  });

  it('nhắc khi còn 14 ngày trở xuống, đúng hạn là hôm nay, quá hạn đếm ngày', () => {
    expect(deadlineStatus(year(), at('2026-12-01'))).toMatchObject({ daysLeft: 14, reminder: true, overdue: false });
    expect(deadlineStatus(year(), at('2026-11-30'))?.reminder).toBe(false);
    expect(deadlineWarning(deadlineStatus(year(), at('2026-12-15')))).toMatch(/Hôm nay là hạn.*15\/12\/2026/);
    expect(deadlineWarning(deadlineStatus(year(), at('2026-12-18')))).toMatch(/quá hạn.* 3 ngày/);
    expect(deadlineWarning(deadlineStatus(year(), at('2026-12-10')))).toMatch(/Còn 5 ngày/);
    expect(deadlineWarning(deadlineStatus(year(), at('2026-10-03')))).toBeNull();
  });

  it('gia hạn đến 15/01 năm sau thì tính theo hạn mới', () => {
    expect(deadlineStatus(year('2027-01-15'), at('2026-12-20'))).toMatchObject({ date: '2027-01-15', extended: true, daysLeft: 26, overdue: false });
  });

  it('ngày theo giờ Việt Nam: 17:30 UTC đã sang ngày hôm sau', () => {
    expect(todayVn(new Date('2026-12-14T17:30:00Z'))).toBe('2026-12-15');
    expect(todayVn(new Date('2026-12-14T16:30:00Z'))).toBe('2026-12-14');
  });

  it('chỉ đặt hạn trong 15/12 đến 15/01 năm sau; gia hạn phải có căn cứ', () => {
    expect(() => validateDeadline(2026, '2026-12-15', undefined)).not.toThrow();
    expect(() => validateDeadline(2026, '2027-01-15', 'Chỉ đạo của cấp có thẩm quyền')).not.toThrow();
    expect(() => validateDeadline(2026, '2027-01-15', '')).toThrow(BadRequestException);
    expect(() => validateDeadline(2026, '2026-12-14', 'x lý do')).toThrow(/từ 15\/12\/2026 đến 15\/01\/2027/);
    expect(() => validateDeadline(2026, '2027-01-16', 'x lý do')).toThrow(BadRequestException);
    expect(() => validateDeadline(2026, '15/12/2026', undefined)).toThrow(/YYYY-MM-DD/);
  });
});

describe('EvaluationService: hạn 15/12', () => {
  it('danh sách kỳ kèm hạn; Văn phòng gia hạn, hạn mặc định thì xóa gia hạn, có nhật ký', async () => {
    const h = await buildEvaluation();
    const actor = { id: 'acc-office', username: 'vp', personId: null };
    const created = await h.repos.periods.create({ type: 'YEAR', year: 2026, number: null, label: '2026', startDate: '2026-01-01', endDate: '2026-12-31', catalogVersionId: 'v', createdBy: null });
    await h.repos.periods.create({ type: 'QUARTER', year: 2026, number: 3, label: '2026-Q3', startDate: '2026-07-01', endDate: '2026-09-30', catalogVersionId: 'v', createdBy: null });

    const list = await h.service.listPeriods();
    expect(list.find((p) => p.label === '2026')?.deadline).toMatchObject({ date: '2026-12-15', extended: false });
    expect(list.find((p) => p.label === '2026-Q3')?.deadline).toBeNull();

    await expect(h.service.setDeadline(actor, created.id, '2027-01-15')).rejects.toBeInstanceOf(BadRequestException);
    const extended = await h.service.setDeadline(actor, created.id, '2027-01-15', 'Theo chỉ đạo của Ban Thường vụ');
    expect(extended).toMatchObject({ ratingDeadline: '2027-01-15', deadline: { extended: true } });
    expect((await h.service.setDeadline(actor, created.id, '2026-12-15')).ratingDeadline).toBeNull();
    expect(h.audit.filter((a) => a.action === 'evaluation.period.deadline')).toHaveLength(2);

    const quarter = (await h.repos.periods.findAll()).find((p) => p.label === '2026-Q3')!;
    await expect(h.service.setDeadline(actor, quarter.id, '2026-12-15')).rejects.toThrow(/Chỉ kỳ năm/);
  });

  it('nhắc việc gửi cho đúng người đang giữ hồ sơ năm chưa xong', async () => {
    const h = await buildEvaluation();
    const actor = { id: 'acc-office', username: 'vp', personId: null };
    const period = await h.repos.periods.create({ type: 'YEAR', year: 2026, number: null, label: '2026', startDate: '2026-01-01', endDate: '2026-12-31', catalogVersionId: 'v', createdBy: null });
    const base = { periodId: period.id, positionId: 'pos', createdBy: null };
    await h.repos.evaluations.create({ ...base, personId: PEOPLE.staff });
    const second = await h.repos.evaluations.create({ ...base, personId: PEOPLE.other });
    await h.repos.evaluations.update(second.id, { status: 'SELF_SUBMITTED' });
    const approved = await h.repos.evaluations.create({ ...base, personId: PEOPLE.head });
    await h.repos.evaluations.update(approved.id, { status: 'APPROVED' });

    // staff chưa tự chấm → chính staff; other đã tự chấm → người thẩm định là head; hồ sơ đã phê duyệt không nhắc.
    expect(await h.service.remindDeadline(actor, period.id)).toEqual({ notified: 2 });
    expect(h.notifier.of('DEADLINE_REMINDER')).toEqual([expect.objectContaining({ to: [PEOPLE.staff, PEOPLE.head] })]);
    expect(JSON.stringify(h.notifier.sent)).toContain('15/12/2026');
  });
});
