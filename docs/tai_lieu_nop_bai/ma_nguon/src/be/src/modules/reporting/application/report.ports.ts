import type { Draft } from './draft-templates.js';
import type { PeriodReport, ReportAxisScore, ReportPeriod, ReportRating, ReportStatus, UnitReport } from './report.model.js';

/** Một hồ sơ đánh giá như mô-đun evaluation cung cấp, chưa ghép tên và đơn vị. */
export interface SourceEvaluation {
  id: string;
  personId: string;
  positionId: string;
  status: ReportStatus;
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: ReportRating | null;
  /** Nhãn chính sách điểm đã dùng khi thẩm định, nếu có. */
  policyVersion: string | null;
}

/** Một hồ sơ đánh giá tập thể như mô-đun evaluation cung cấp (đã theo phạm vi xem của người gọi). */
export interface SourceUnitEvaluation {
  id: string;
  unitCode: string;
  unitName: string;
  unitType: 'BAN' | 'PHONG';
  headPersonId: string | null;
  status: ReportStatus;
  generalScore: number | null;
  resultScore: number | null;
  totalScore: number | null;
  rating: ReportRating | null;
  warnings: number;
  axes: ReportAxisScore[];
}

export interface ReportActor {
  id: string;
  username: string;
  personId: string | null;
}

/** Cổng sang mô-đun evaluation. Phạm vi xem do mô-đun đó quyết định. */
export abstract class EvaluationSource {
  abstract getPeriod(periodId: string): Promise<ReportPeriod | null>;
  abstract listPeriods(): Promise<ReportPeriod[]>;
  abstract listEvaluations(actor: ReportActor, periodId: string, canReadAll: boolean): Promise<SourceEvaluation[]>;
}

/** Cổng sang mô-đun evaluation cho hồ sơ tập thể theo năm. */
export abstract class UnitEvaluationSource {
  abstract list(actor: ReportActor, periodId: string, readAll: boolean): Promise<SourceUnitEvaluation[]>;
}

/** Cổng sang mô-đun organization: tên cán bộ và thông tin vị trí, đơn vị. */
export abstract class OrgLookup {
  abstract persons(): Promise<Map<string, { fullName: string }>>;
  abstract positions(): Promise<Map<string, { title: string; level: number; unitCode: string; unitName: string }>>;
}

/** Cổng xuất tệp. Nhận báo cáo đã dựng, trả về nội dung tệp. */
export abstract class ReportRenderer {
  abstract renderExcel(report: PeriodReport): Promise<Buffer>;
  abstract renderPdf(report: PeriodReport): Promise<Buffer>;
  abstract renderDraftDocx(draft: Draft): Promise<Buffer>;
  abstract renderUnitExcel(report: UnitReport): Promise<Buffer>;
}
