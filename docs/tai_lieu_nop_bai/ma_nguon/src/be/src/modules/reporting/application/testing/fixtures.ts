import { Test } from '@nestjs/testing';
import { Clock } from '../../../../common/clock.js';
import { AuditService } from '../../../security/index.js';
import type { PeriodReport, ReportPeriod, ReportRating, ReportRow, ReportStatus, UnitReport } from '../report.model.js';
import { EvaluationSource, OrgLookup, ReportRenderer, UnitEvaluationSource } from '../report.ports.js';
import type { ReportActor, SourceEvaluation, SourceUnitEvaluation } from '../report.ports.js';
import { ReportService } from '../report.service.js';
import { buildPeriodReport } from '../report-builder.js';

let seq = 0;

/** Một dòng báo cáo; các trường không nêu có giá trị mặc định hợp lý. */
export function row(over: Partial<ReportRow> & { fullName: string }): ReportRow {
  return {
    evaluationId: `ev-${++seq}`,
    personId: `p-${seq}`,
    positionTitle: 'Chuyên viên',
    level: 5,
    unitCode: 'TCCB',
    unitName: 'Phòng Tổ chức cán bộ',
    status: 'APPROVED',
    generalScore: 25,
    resultScore: 60,
    totalScore: 85,
    rating: 'HOAN_THANH_TOT',
    ...over,
  };
}

/** Dòng đã phê duyệt với tổng điểm và xếp loại cho trước. */
export const approved = (fullName: string, totalScore: number, rating: ReportRating, over: Partial<ReportRow> = {}) =>
  row({ fullName, totalScore, rating, status: 'APPROVED', ...over });

export const pending = (fullName: string, status: ReportStatus, over: Partial<ReportRow> = {}) =>
  row({ fullName, status, totalScore: null, rating: null, generalScore: null, resultScore: null, ...over });

export const PERIOD: ReportPeriod = { id: 'per-1', label: '2026-Q3', type: 'QUARTER', startDate: '2026-07-01', endDate: '2026-09-30', status: 'OPEN' };

export function report(rows: ReportRow[], over: { scope?: 'ALL' | 'LIMITED'; policyVersions?: string[] } = {}): PeriodReport {
  return buildPeriodReport({
    period: PERIOD,
    rows,
    scope: over.scope ?? 'ALL',
    generatedAt: new Date('2026-10-03T08:00:00Z'),
    policyVersions: over.policyVersions ?? ['v1-gia-dinh'],
  });
}

// --------------------------------------------------------------- đối tượng giả cho ReportService

export class FakeSource extends EvaluationSource {
  period: ReportPeriod | null = PERIOD;
  evaluations: SourceEvaluation[] = [];
  calls: { actor: ReportActor; periodId: string; canReadAll: boolean }[] = [];
  periods: ReportPeriod[] = [];
  async getPeriod() {
    return this.period;
  }
  async listPeriods() {
    return this.periods;
  }
  async listEvaluations(actor: ReportActor, periodId: string, canReadAll: boolean) {
    this.calls.push({ actor, periodId, canReadAll });
    return this.evaluations;
  }
}

export class FakeUnitSource extends UnitEvaluationSource {
  records: SourceUnitEvaluation[] = [];
  calls: { actor: ReportActor; periodId: string; readAll: boolean }[] = [];
  async list(actor: ReportActor, periodId: string, readAll: boolean) {
    this.calls.push({ actor, periodId, readAll });
    return this.records;
  }
}

export class FakeLookup extends OrgLookup {
  people = new Map<string, { fullName: string }>();
  places = new Map<string, { title: string; level: number; unitCode: string; unitName: string }>();
  async persons() {
    return this.people;
  }
  async positions() {
    return this.places;
  }
}

export class FakeRenderer extends ReportRenderer {
  async renderExcel(r: PeriodReport) {
    return Buffer.from(`xlsx:${r.rows.length}`);
  }
  async renderPdf(r: PeriodReport) {
    return Buffer.from(`pdf:${r.rows.length}`);
  }
  async renderUnitExcel(r: UnitReport) {
    return Buffer.from(`unit-xlsx:${r.rows.length}`);
  }
  async renderDraftDocx(d: { title: string }) {
    return Buffer.from(`docx:${d.title}`);
  }
}

export const actor: ReportActor = { id: 'acc-1', username: 'nguoi-xem', personId: 'p-1' };

export async function buildReportService() {
  const source = new FakeSource();
  const unitSource = new FakeUnitSource();
  const lookup = new FakeLookup();
  const audit: { action: string; details?: Record<string, unknown> }[] = [];
  lookup.people.set('p-a', { fullName: 'Nguyễn Văn A' });
  lookup.people.set('p-b', { fullName: 'Trần Thị B' });
  lookup.places.set('pos-a', { title: 'Chuyên viên', level: 5, unitCode: 'TCCB', unitName: 'Phòng Tổ chức cán bộ' });
  lookup.places.set('pos-b', { title: 'Văn thư', level: 5, unitCode: 'VP', unitName: 'Văn phòng' });
  source.evaluations = [
    { id: 'e1', personId: 'p-a', positionId: 'pos-a', status: 'APPROVED', generalScore: 25, resultScore: 64, totalScore: 89, rating: 'HOAN_THANH_TOT', policyVersion: 'v1-gia-dinh' },
    { id: 'e2', personId: 'p-b', positionId: 'pos-b', status: 'PLANNED', generalScore: null, resultScore: null, totalScore: null, rating: null, policyVersion: null },
  ];
  const moduleRef = await Test.createTestingModule({
    providers: [
      ReportService,
      { provide: EvaluationSource, useValue: source },
      { provide: UnitEvaluationSource, useValue: unitSource },
      { provide: OrgLookup, useValue: lookup },
      { provide: ReportRenderer, useValue: new FakeRenderer() },
      { provide: Clock, useValue: { now: () => new Date('2026-10-03T08:00:00Z') } },
      { provide: AuditService, useValue: { record: async (e: { action: string }) => void audit.push(e) } },
    ],
  }).compile();
  return { service: moduleRef.get(ReportService), source, unitSource, lookup, audit };
}
