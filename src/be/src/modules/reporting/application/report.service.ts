import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from '../../security/index.js';
import { buildDraft, buildUnitDecisionDraft } from './draft-templates.js';
import type { Draft, DraftKind } from './draft-templates.js';
import { buildPeriodReport } from './report-builder.js';
import type { PeriodReport, ReportRow, Trend, UnitReport, UnitReportRow } from './report.model.js';
import { EvaluationSource, OrgLookup, ReportRenderer, UnitEvaluationSource } from './report.ports.js';
import { buildUnitReport } from './unit-report-builder.js';
import type { ReportActor } from './report.ports.js';

export type ExportFormat = 'xlsx' | 'pdf';

export interface ExportedFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/**
 * Báo cáo chỉ đọc (ADR-015). Phạm vi dữ liệu do mô-đun evaluation quyết định; mô-đun này không lưu gì,
 * chỉ ghép tên, đơn vị rồi tổng hợp. Xem, xuất đều ghi nhật ký vì có họ tên và điểm của cán bộ.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly source: EvaluationSource,
    private readonly unitSource: UnitEvaluationSource,
    private readonly lookup: OrgLookup,
    private readonly renderer: ReportRenderer,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async periodReport(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<PeriodReport> {
    const report = await this.build(actor, periodId, canReadAll);
    await this.audit.record({
      action: 'report.view',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: report.period.label, scope: report.scope, rows: report.rows.length },
    });
    return report;
  }

  /** Xu hướng điểm trung bình và tỷ lệ hoàn tất qua các kỳ gần nhất cùng loại (ADR-027). Mỗi kỳ dùng đúng phạm vi xem của người gọi. */
  async trend(actor: ReportActor, type: string, limit: number, canReadAll: boolean): Promise<Trend> {
    const periods = (await this.source.listPeriods())
      .filter((p) => p.type === type)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(-limit);
    const points = [];
    for (const p of periods) {
      const { overall } = await this.build(actor, p.id, canReadAll);
      points.push({
        period: p,
        evaluations: overall.evaluations,
        approved: overall.approved,
        completionRate: overall.completionRate,
        averageTotal: overall.averageTotal,
        ratings: overall.ratings,
      });
    }
    await this.audit.record({
      action: 'report.trend',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      details: { type, scope: canReadAll ? 'ALL' : 'LIMITED', periods: points.length },
    });
    return { type, scope: canReadAll ? 'ALL' : 'LIMITED', points };
  }

  /** Dự thảo tổng hợp cả Ban nên cần quyền xem toàn bộ: không dựng văn bản tổng hợp từ một phần dữ liệu. */
  async draft(actor: ReportActor, periodId: string, kind: DraftKind, canReadAll: boolean): Promise<Draft> {
    if (!canReadAll) {
      throw new ForbiddenException('Dự thảo văn bản tổng hợp cần quyền xem toàn bộ hồ sơ đánh giá của kỳ');
    }
    const report = await this.build(actor, periodId, true);
    const draft = buildDraft(kind, report);
    await this.audit.record({
      action: 'report.draft',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: report.period.label, kind, approvedCount: draft.approvedCount },
    });
    return draft;
  }

  /** Tải dự thảo thành tệp Word (ADR-028). Cùng điều kiện với xem dự thảo; ghi thêm nhật ký xuất tệp. */
  async exportDraft(actor: ReportActor, periodId: string, kind: DraftKind, canReadAll: boolean): Promise<ExportedFile> {
    const draft = await this.draft(actor, periodId, kind, canReadAll);
    const period = await this.source.getPeriod(periodId);
    const buffer = await this.renderer.renderDraftDocx(draft);
    await this.audit.record({
      action: 'report.draft.export',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: period?.label, kind, format: 'docx', bytes: buffer.length },
    });
    return {
      filename: `${kind === 'REPORT' ? 'du-thao-bao-cao' : kind === 'NOTICE' ? 'du-thao-thong-bao' : 'du-thao-quyet-dinh'}-${period?.label ?? periodId}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    };
  }

  async export(actor: ReportActor, periodId: string, format: ExportFormat, canReadAll: boolean): Promise<ExportedFile> {
    const report = await this.build(actor, periodId, canReadAll);
    const buffer = format === 'xlsx' ? await this.renderer.renderExcel(report) : await this.renderer.renderPdf(report);
    await this.audit.record({
      action: 'report.export',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: report.period.label, format, scope: report.scope, rows: report.rows.length, bytes: buffer.length },
    });
    return {
      filename: `bao-cao-danh-gia-${report.period.label}.${format}`,
      contentType: CONTENT_TYPES[format],
      buffer,
    };
  }

  // ------------------------------------------------------------ tập thể (ADR-031)

  /** Báo cáo xếp loại tập thể của một kỳ năm, trong phạm vi người xem được. */
  async unitReport(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<UnitReport> {
    const report = await this.buildUnits(actor, periodId, canReadAll);
    await this.audit.record({
      action: 'report.unit.view',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: report.period.label, scope: report.scope, rows: report.rows.length },
    });
    return report;
  }

  async exportUnits(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<ExportedFile> {
    const report = await this.buildUnits(actor, periodId, canReadAll);
    const buffer = await this.renderer.renderUnitExcel(report);
    await this.audit.record({
      action: 'report.unit.export',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: report.period.label, format: 'xlsx', scope: report.scope, rows: report.rows.length, bytes: buffer.length },
    });
    return { filename: `bao-cao-tap-the-${report.period.label}.xlsx`, contentType: CONTENT_TYPES.xlsx, buffer };
  }

  /** Dự thảo quyết định công nhận xếp loại tập thể; cần quyền xem toàn bộ như dự thảo của cá nhân. */
  async unitDraft(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<Draft> {
    if (!canReadAll) throw new ForbiddenException('Dự thảo văn bản tổng hợp cần quyền xem toàn bộ hồ sơ đánh giá của kỳ');
    const report = await this.buildUnits(actor, periodId, true);
    const draft = buildUnitDecisionDraft(report);
    await this.audit.record({
      action: 'report.unit.draft',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: report.period.label, approvedCount: draft.approvedCount },
    });
    return draft;
  }

  async exportUnitDraft(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<ExportedFile> {
    const draft = await this.unitDraft(actor, periodId, canReadAll);
    const period = await this.source.getPeriod(periodId);
    const buffer = await this.renderer.renderDraftDocx(draft);
    await this.audit.record({
      action: 'report.unit.draft.export',
      outcome: 'SUCCESS',
      targetType: 'evaluation_period',
      targetId: periodId,
      details: { period: period?.label, format: 'docx', bytes: buffer.length },
    });
    return {
      filename: `du-thao-quyet-dinh-tap-the-${period?.label ?? periodId}.docx`,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    };
  }

  private async buildUnits(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<UnitReport> {
    const period = await this.source.getPeriod(periodId);
    if (!period) throw new NotFoundException(`Không tìm thấy kỳ đánh giá: ${periodId}`);
    if (period.type !== 'YEAR') throw new BadRequestException('Chỉ xếp loại tập thể theo năm (Nghị định 335 Điều 9.1)');
    const [records, persons] = await Promise.all([this.unitSource.list(actor, periodId, canReadAll), this.lookup.persons()]);
    const rows: UnitReportRow[] = records.map((r) => ({
      evaluationId: r.id,
      unitCode: r.unitCode,
      unitName: r.unitName,
      unitType: r.unitType,
      headName: r.headPersonId ? (persons.get(r.headPersonId)?.fullName ?? '(không rõ)') : '(chưa có người đứng đầu)',
      status: r.status,
      generalScore: r.generalScore,
      resultScore: r.resultScore,
      totalScore: r.totalScore,
      rating: r.rating,
      warnings: r.warnings,
      axes: r.axes,
    }));
    return buildUnitReport({ period, rows, scope: canReadAll ? 'ALL' : 'LIMITED', generatedAt: this.clock.now() });
  }

  private async build(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<PeriodReport> {
    const period = await this.source.getPeriod(periodId);
    if (!period) throw new NotFoundException(`Không tìm thấy kỳ đánh giá: ${periodId}`);

    const [evaluations, persons, positions] = await Promise.all([
      this.source.listEvaluations(actor, periodId, canReadAll),
      this.lookup.persons(),
      this.lookup.positions(),
    ]);

    const rows: ReportRow[] = evaluations.map((e) => {
      const person = persons.get(e.personId);
      const position = positions.get(e.positionId);
      return {
        evaluationId: e.id,
        personId: e.personId,
        fullName: person?.fullName ?? '(không rõ)',
        positionTitle: position?.title ?? '(không rõ)',
        level: position?.level ?? 99,
        unitCode: position?.unitCode ?? '?',
        unitName: position?.unitName ?? '(không rõ)',
        status: e.status,
        generalScore: e.generalScore,
        resultScore: e.resultScore,
        totalScore: e.totalScore,
        rating: e.rating,
      };
    });

    const policyVersions = [...new Set(evaluations.flatMap((e) => (e.policyVersion ? [e.policyVersion] : [])))].sort();
    return buildPeriodReport({
      period,
      rows,
      scope: canReadAll ? 'ALL' : 'LIMITED',
      generatedAt: this.clock.now(),
      policyVersions,
    });
  }
}
