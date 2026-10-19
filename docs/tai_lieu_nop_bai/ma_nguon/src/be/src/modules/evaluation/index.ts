/** Giao diện công khai của mô-đun evaluation: các mô-đun khác chỉ import từ đây. */
export { EvaluationModule } from './evaluation.module.js';
export { EvaluationService } from './application/evaluation.service.js';
export { UnitEvaluationService } from './application/unit-evaluation.service.js';
export type { Actor } from './application/evaluation.service.js';
export type { EvaluationModel, EvaluationStatus, PeriodModel } from './application/evaluation.model.js';
