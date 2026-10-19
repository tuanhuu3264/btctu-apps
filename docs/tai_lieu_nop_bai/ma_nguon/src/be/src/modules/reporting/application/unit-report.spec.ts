import { BadRequestException, ForbiddenException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { FileReportRenderer } from '../data-access/file-report-renderer.js';
import { renderDraftDocx } from '../data-access/draft-docx.js';
import { buildUnitDecisionDraft } from './draft-templates.js';
import type { UnitReportRow } from './report.model.js';
import type { SourceUnitEvaluation } from './report.ports.js';
import { actor, buildReportService, PERIOD } from './testing/fixtures.js';
import { buildUnitReport, unitQuota } from './unit-report-builder.js';

const YEAR = { ...PERIOD, id: 'per-y', label: '2026', type: 'YEAR', startDate: '2026-01-01', endDate: '2026-12-31' };

const unitRow = (over: Partial<UnitReportRow> & { unitName: string }): UnitReportRow => ({
  evaluationId: `ue-${over.unitName}`,
  unitCode: over.unitName,
  unitType: 'PHONG',
  headName: 'Người đứng đầu',
  status: 'APPROVED',
  generalScore: 26,
  resultScore: 60,
  totalScore: 86,
  rating: 'HOAN_THANH_TOT',
  warnings: 0,
  axes: [],
  ...over,
});

const build = (rows: UnitReportRow[], scope: 'ALL' | 'LIMITED' = 'ALL') =>
  buildUnitReport({ period: YEAR, rows, scope, generatedAt: new Date('2026-12-10T08:00:00Z') });

describe('báo cáo tập thể: bộ dựng', () => {
  it('đếm theo trạng thái; điểm và xếp loại chỉ tính hồ sơ đã phê duyệt; Ban đứng đầu', () => {
    const r = build([
      unitRow({ unitName: 'Phòng B', totalScore: 92, rating: 'XUAT_SAC' }),
      unitRow({ unitName: 'Ban', unitType: 'BAN', totalScore: 80, rating: 'HOAN_THANH_TOT' }),
      unitRow({ unitName: 'Phòng A', status: 'REVIEWED', totalScore: 70, rating: 'HOAN_THANH_TOT' }),
      unitRow({ unitName: 'Phòng C', status: 'PLANNED', totalScore: null, rating: null, generalScore: null, resultScore: null }),
    ]);
    expect(r.rows.map((x) => x.unitName)).toEqual(['Ban', 'Phòng A', 'Phòng B', 'Phòng C']);
    expect(r).toMatchObject({ units: 4, approved: 2, pendingApproval: 1, inProgress: 1, averageTotal: 86 });
    expect(r.ratings).toEqual({ XUAT_SAC: 1, HOAN_THANH_TOT: 1, HOAN_THANH: 0, KHONG_HOAN_THANH: 0 });
    expect(r.notes.join('\n')).toMatch(/Còn 2 hồ sơ chưa phê duyệt/);
  });

  it('hạn mức xuất sắc: không quá 20% số tập thể hoàn thành tốt, so bằng số nguyên', () => {
    const r = (x: number, g: number) => unitQuota({ XUAT_SAC: x, HOAN_THANH_TOT: g, HOAN_THANH: 0, KHONG_HOAN_THANH: 0 });
    expect(r(1, 5)).toMatchObject({ allowed: 1, exceeded: false });
    expect(r(1, 4)).toMatchObject({ allowed: 0.8, exceeded: true });
    expect(r(0, 0).exceeded).toBe(false);
    expect(r(1, 0).exceeded).toBe(true);
  });

  it('phạm vi giới hạn và vượt hạn mức được nêu trong lưu ý; báo cáo rỗng không lỗi', () => {
    const limited = build([unitRow({ unitName: 'Phòng A', totalScore: 95, rating: 'XUAT_SAC', warnings: 2 })], 'LIMITED');
    const notes = limited.notes.join('\n');
    expect(notes).toMatch(/phạm vi của bạn/);
    expect(notes).toMatch(/vượt hạn mức 20%/);
    expect(notes).toMatch(/cảnh báo điều kiện xếp loại/);
    const empty = build([]);
    expect(empty).toMatchObject({ units: 0, approved: 0, averageTotal: null });
  });
});

describe('ReportService: tập thể', () => {
  const record = (over: Partial<SourceUnitEvaluation> & { id: string }): SourceUnitEvaluation => ({
    unitCode: 'P1',
    unitName: 'Phòng 1',
    unitType: 'PHONG',
    headPersonId: 'p-a',
    status: 'APPROVED',
    generalScore: 26,
    resultScore: 60,
    totalScore: 86,
    rating: 'HOAN_THANH_TOT',
    warnings: 1,
    axes: [],
    ...over,
  });

  async function setup() {
    const h = await buildReportService();
    h.source.period = YEAR;
    h.unitSource.records = [record({ id: 'u1' }), record({ id: 'u2', unitCode: 'P2', unitName: 'Phòng 2', headPersonId: null, status: 'PLANNED', totalScore: null, rating: null })];
    return h;
  }

  it('ghép tên người đứng đầu, truyền đúng cờ xem tất cả, chỉ kỳ năm', async () => {
    const { service, unitSource, source } = await setup();
    const report = await service.unitReport(actor, 'per-y', true);
    expect(report.rows.map((r) => [r.unitName, r.headName])).toEqual([['Phòng 1', 'Nguyễn Văn A'], ['Phòng 2', '(chưa có người đứng đầu)']]);
    expect(report.scope).toBe('ALL');
    expect(unitSource.calls[0]).toMatchObject({ periodId: 'per-y', readAll: true });
    expect((await service.unitReport(actor, 'per-y', false)).scope).toBe('LIMITED');
    expect(unitSource.calls[1].readAll).toBe(false);

    source.period = PERIOD; // kỳ quý
    await expect(service.unitReport(actor, 'per-1', true)).rejects.toBeInstanceOf(BadRequestException);
    source.period = null;
    await expect(service.unitReport(actor, 'khong-co', true)).rejects.toThrow('Không tìm thấy');
  });

  it('xuất Excel và dự thảo đều ghi nhật ký, nhật ký không có tên cán bộ', async () => {
    const { service, audit } = await setup();
    const xlsx = await service.exportUnits(actor, 'per-y', true);
    expect(xlsx.filename).toBe('bao-cao-tap-the-2026.xlsx');
    expect(xlsx.buffer.toString()).toBe('unit-xlsx:2');
    const docx = await service.exportUnitDraft(actor, 'per-y', true);
    expect(docx.filename).toBe('du-thao-quyet-dinh-tap-the-2026.docx');
    expect(audit.map((a) => a.action)).toEqual(['report.unit.export', 'report.unit.draft', 'report.unit.draft.export']);
    expect(JSON.stringify(audit)).not.toContain('Nguyễn Văn A');
  });

  it('dự thảo cần quyền xem toàn bộ', async () => {
    const { service } = await setup();
    await expect(service.unitDraft(actor, 'per-y', false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.exportUnitDraft(actor, 'per-y', false)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('dự thảo quyết định tập thể và tệp Excel', () => {
  const report = build([
    unitRow({ unitName: 'Ban Tổ chức Tỉnh ủy', unitType: 'BAN', totalScore: 91.5, rating: 'XUAT_SAC', generalScore: 28, resultScore: 63.5 }),
    unitRow({ unitName: 'Văn phòng' }),
    unitRow({ unitName: 'Phòng chưa duyệt', status: 'SELF_SUBMITTED', totalScore: null, rating: null, generalScore: null, resultScore: null }),
  ]);

  it('chỉ liệt kê tập thể đã phê duyệt, căn cứ nghị định 335, có cảnh báo hạn mức khi vượt', () => {
    const draft = buildUnitDecisionDraft(report);
    expect(draft).toMatchObject({ kind: 'DECISION', approvedCount: 2 });
    expect(draft.body).toContain('Nghị định số 335/2025/NĐ-CP');
    expect(draft.body).toContain('1. Ban Tổ chức Tỉnh ủy: 91,50 điểm, Hoàn thành xuất sắc nhiệm vụ.');
    expect(draft.body).toContain('2. Văn phòng: 86,00 điểm, Hoàn thành tốt nhiệm vụ.');
    expect(draft.body).not.toContain('Phòng chưa duyệt');
    expect(draft.body).toMatch(/vượt hạn mức 20%/);
  });

  it('dự thảo xuất thành tệp Word hợp lệ', async () => {
    const buffer = await renderDraftDocx(buildUnitDecisionDraft(report));
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
    expect(xml).toContain('xếp loại chất lượng tập thể');
    expect(xml).toContain('Văn phòng');
  });

  it('Excel đọc lại được, điểm là số, có đủ lưu ý', async () => {
    const buffer = await new FileReportRenderer().renderUnitExcel(report);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Tập thể')!;
    const rows = new Map<string, ExcelJS.Row>();
    ws.eachRow((row) => rows.set(String(row.getCell(2).value), row));
    const ban = rows.get('Ban Tổ chức Tỉnh ủy')!;
    expect(ban.getCell(7).value).toBe(91.5);
    expect(ban.getCell(8).value).toBe('Hoàn thành xuất sắc nhiệm vụ');
    expect(rows.get('Phòng chưa duyệt')!.getCell(7).value).toBeNull();
    const text = JSON.stringify(ws.getSheetValues());
    expect(text).toContain('cấp tỉnh quy định chi tiết');
    expect(wb.getWorksheet('Theo trục')).toBeUndefined();
  });

  it('báo cáo theo trục: trung bình từng trục, chỉ hồ sơ đã phê duyệt; Excel có trang "Theo trục"', async () => {
    const axes = (t1: number, t2: number) => [
      { code: 'G1', name: 'Chính trị', kind: 'GENERAL' as const, maxPoints: 10, points: t1 },
      { code: 'T2', name: 'Nhiệm vụ', kind: 'RESULT' as const, maxPoints: 20, points: t2 },
    ];
    const rows: UnitReportRow[] = [
      unitRow({ unitName: 'Phòng A', axes: axes(8, 16) }),
      unitRow({ unitName: 'Phòng B', axes: axes(10, 12) }),
      unitRow({ unitName: 'Phòng C', status: 'REVIEWED', axes: axes(1, 1) }),
      unitRow({ unitName: 'Phòng D' }),
    ];
    const report = build(rows);
    expect(report.axisSummary).toEqual([
      { code: 'G1', name: 'Chính trị', kind: 'GENERAL', maxPoints: 10, count: 2, average: 9, ratio: 0.9, lowest: 8 },
      { code: 'T2', name: 'Nhiệm vụ', kind: 'RESULT', maxPoints: 20, count: 2, average: 14, ratio: 0.7, lowest: 12 },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await new FileReportRenderer().renderUnitExcel(report)) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Theo trục')!;
    const lines = new Map<string, ExcelJS.Row>();
    ws.eachRow((row) => lines.set(String(row.getCell(2).value), row));
    expect(lines.get('Phòng A')!.getCell(4).value).toBe(16);
    expect(lines.has('Phòng C')).toBe(false);
    expect(lines.get('Trung bình')!.getCell(3).value).toBe(9);
    expect(lines.get('Thấp nhất')!.getCell(4).value).toBe(12);
  });

  it('không có hồ sơ chấm theo trục thì không có tổng hợp trục', () => {
    expect(build([unitRow({ unitName: 'Phòng A' })]).axisSummary).toEqual([]);
  });
});
