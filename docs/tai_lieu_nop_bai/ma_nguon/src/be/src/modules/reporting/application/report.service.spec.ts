import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { actor, buildReportService } from './testing/fixtures.js';

describe('ReportService', () => {
  it('ghép tên, vị trí, đơn vị vào từng hồ sơ và tổng hợp', async () => {
    const { service } = await buildReportService();
    const report = await service.periodReport(actor, 'per-1', true);

    expect(report.period.label).toBe('2026-Q3');
    expect(report.rows.map((r) => [r.fullName, r.unitName, r.positionTitle, r.status])).toEqual([
      ['Nguyễn Văn A', 'Phòng Tổ chức cán bộ', 'Chuyên viên', 'APPROVED'],
      ['Trần Thị B', 'Văn phòng', 'Văn thư', 'PLANNED'],
    ]);
    expect(report.overall).toMatchObject({ evaluations: 2, approved: 1, inProgress: 1, averageTotal: 89 });
    expect(report.notes.join('\n')).toMatch(/chính sách v1-gia-dinh/);
  });

  it('chuyển đúng cờ xem tất cả cho nguồn dữ liệu và đánh dấu phạm vi', async () => {
    const { service, source } = await buildReportService();
    expect((await service.periodReport(actor, 'per-1', true)).scope).toBe('ALL');
    const limited = await service.periodReport(actor, 'per-1', false);
    expect(limited.scope).toBe('LIMITED');
    expect(limited.notes.join('\n')).toMatch(/phạm vi của bạn/);
    expect(source.calls.map((c) => c.canReadAll)).toEqual([true, false]);
    expect(source.calls[0].actor).toBe(actor);
  });

  it('báo không tìm thấy khi kỳ không tồn tại', async () => {
    const { service, source } = await buildReportService();
    source.period = null;
    await expect(service.periodReport(actor, 'khong-co', true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.export(actor, 'khong-co', 'xlsx', true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.draft(actor, 'khong-co', 'REPORT', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('thiếu thông tin tra cứu thì ghi "(không rõ)" thay vì lỗi', async () => {
    const { service, lookup } = await buildReportService();
    lookup.people.clear();
    lookup.places.clear();
    const report = await service.periodReport(actor, 'per-1', true);
    expect(report.rows[0]).toMatchObject({ fullName: '(không rõ)', positionTitle: '(không rõ)', unitName: '(không rõ)' });
  });

  describe('xu hướng', () => {
    it('chỉ lấy các kỳ cùng loại, cũ đến mới, giới hạn số kỳ gần nhất; ghi nhật ký không có tên cán bộ', async () => {
      const { service, source, audit } = await buildReportService();
      const mk = (id: string, type: string, startDate: string) => ({ id, label: id, type, startDate, endDate: startDate, status: 'OPEN' });
      source.periods = [mk('q3', 'QUARTER', '2026-07-01'), mk('m9', 'MONTH', '2026-09-01'), mk('q1', 'QUARTER', '2026-01-01'), mk('q2', 'QUARTER', '2026-04-01')];

      const trend = await service.trend(actor, 'QUARTER', 2, true);
      expect(trend.points.map((p) => p.period.id)).toEqual(['q2', 'q3']);
      expect(trend.points[0]).toMatchObject({ evaluations: 2, approved: 1, averageTotal: 89, completionRate: 0.5 });
      expect(trend.scope).toBe('ALL');
      const log = audit.find((a) => a.action === 'report.trend');
      expect(log?.details).toEqual({ type: 'QUARTER', scope: 'ALL', periods: 2 });
      expect(JSON.stringify(audit)).not.toContain('Nguyễn Văn A');
    });

    it('không có kỳ nào thì trả danh sách rỗng; phạm vi giới hạn được truyền xuống nguồn', async () => {
      const { service, source } = await buildReportService();
      expect((await service.trend(actor, 'YEAR', 8, false)).points).toEqual([]);
      source.periods = [{ id: 'q1', label: 'q1', type: 'QUARTER', startDate: '2026-01-01', endDate: '2026-03-31', status: 'OPEN' }];
      const t = await service.trend(actor, 'QUARTER', 8, false);
      expect(t.scope).toBe('LIMITED');
      expect(source.calls.at(-1)?.canReadAll).toBe(false);
    });
  });

  describe('dự thảo', () => {
    it('chỉ người xem được toàn bộ hồ sơ mới lập được; không đọc dữ liệu khi bị từ chối', async () => {
      const { service, source } = await buildReportService();
      await expect(service.draft(actor, 'per-1', 'REPORT', false)).rejects.toBeInstanceOf(ForbiddenException);
      expect(source.calls).toHaveLength(0);

      const draft = await service.draft(actor, 'per-1', 'REPORT', true);
      expect(draft.title).toMatch(/^Dự thảo báo cáo/);
      expect(draft.approvedCount).toBe(1);
    });
  });

  describe('dự thảo dạng tệp Word', () => {
    it('cùng điều kiện với xem dự thảo, tên tệp ASCII, ghi nhật ký xuất', async () => {
      const { service, audit } = await buildReportService();
      await expect(service.exportDraft(actor, 'per-1', 'REPORT', false)).rejects.toBeInstanceOf(ForbiddenException);
      const file = await service.exportDraft(actor, 'per-1', 'DECISION', true);
      expect(file.filename).toBe('du-thao-quyet-dinh-2026-Q3.docx');
      expect(file.contentType).toMatch(/wordprocessingml/);
      expect(audit.map((a) => a.action)).toEqual(['report.draft', 'report.draft.export']);
    });
  });

  describe('xuất tệp', () => {
    it('Excel và PDF: tên tệp chỉ có ký tự ASCII, đúng loại nội dung', async () => {
      const { service } = await buildReportService();
      const xlsx = await service.export(actor, 'per-1', 'xlsx', true);
      expect(xlsx).toMatchObject({
        filename: 'bao-cao-danh-gia-2026-Q3.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      expect(xlsx.filename).toMatch(/^[\x20-\x7e]+$/);
      const pdf = await service.export(actor, 'per-1', 'pdf', true);
      expect(pdf).toMatchObject({ filename: 'bao-cao-danh-gia-2026-Q3.pdf', contentType: 'application/pdf' });
    });
  });

  describe('nhật ký', () => {
    it('xem, xuất, dự thảo đều được ghi, kèm kỳ và phạm vi, không ghi tên hay điểm cá nhân', async () => {
      const { service, audit } = await buildReportService();
      await service.periodReport(actor, 'per-1', false);
      await service.export(actor, 'per-1', 'pdf', true);
      await service.draft(actor, 'per-1', 'DECISION', true);

      expect(audit.map((a) => a.action)).toEqual(['report.view', 'report.export', 'report.draft']);
      expect(audit[0].details).toMatchObject({ period: '2026-Q3', scope: 'LIMITED', rows: 2 });
      expect(audit[1].details).toMatchObject({ format: 'pdf', scope: 'ALL', rows: 2 });
      expect(audit[2].details).toMatchObject({ kind: 'DECISION', approvedCount: 1 });
      expect(JSON.stringify(audit)).not.toMatch(/Nguyễn Văn A|Trần Thị B/);
    });

    it('bị từ chối thì không ghi bản ghi "đã xem" nào', async () => {
      const { service, audit } = await buildReportService();
      await service.draft(actor, 'per-1', 'REPORT', false).catch(() => undefined);
      expect(audit).toEqual([]);
    });
  });
});
