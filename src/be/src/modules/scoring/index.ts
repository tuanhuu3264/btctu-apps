/** Giao diện công khai của mô-đun scoring: các mô-đun khác chỉ import từ đây. */
export { ScoringModule } from './scoring.module.js';
export {
  classifyByScore,
  totalScore,
  DEFAULT_THRESHOLDS,
  MAX_GENERAL_SCORE,
  MAX_RESULT_SCORE,
} from './application/classification.js';
export type { Rating, Thresholds } from './application/classification.js';
