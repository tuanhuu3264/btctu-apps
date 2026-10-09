import { Injectable } from '@nestjs/common';
import { EvaluationService } from '../../evaluation/index.js';
import { OrgQueryService } from '../../organization/index.js';
import type { ReportPeriod } from '../application/report.model.js';
import { EvaluationSource, OrgLookup } from '../application/report.ports.js';
import type { ReportActor, SourceEvaluation } from '../application/report.ports.js';

/** Adapter sang mô-đun evaluation: dùng đúng quy tắc phạm vi xem của mô-đun đó. */
@Injectable()
export class EvaluationSourceAdapter extends EvaluationSource {
  constructor(private readonly evaluation: EvaluationService) {
    super();
  }

  async getPeriod(periodId: string): Promise<ReportPeriod | null> {
    return (await this.listPeriods()).find((p) => p.id === periodId) ?? null;
  }

  async listPeriods(): Promise<ReportPeriod[]> {
    return (await this.evaluation.listPeriods()).map((p) => ({
      id: p.id,
      label: p.label,
      type: p.type,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
    }));
  }

  async listEvaluations(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<SourceEvaluation[]> {
    const rows = await this.evaluation.listEvaluations(actor, periodId, canReadAll);
    return rows.map((e) => ({
      id: e.id,
      personId: e.personId,
      positionId: e.positionId,
      status: e.status,
      generalScore: e.generalScore,
      resultScore: e.resultScore,
      totalScore: e.totalScore,
      rating: e.rating,
      policyVersion: typeof e.scoringParams?.version === 'string' ? e.scoringParams.version : null,
    }));
  }
}

/** Adapter sang mô-đun organization. */
@Injectable()
export class OrgLookupAdapter extends OrgLookup {
  constructor(private readonly org: OrgQueryService) {
    super();
  }

  async persons() {
    return (await this.org.lookup()).persons;
  }

  async positions() {
    return (await this.org.lookup()).positions;
  }
}
