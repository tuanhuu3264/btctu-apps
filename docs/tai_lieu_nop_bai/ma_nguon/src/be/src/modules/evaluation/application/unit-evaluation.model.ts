import type { Rating } from '../../scoring/index.js';
import type { EvaluationStatus } from './evaluation.model.js';
import type { AxisScore } from './unit-axes.js';

/**
 * Số liệu tham chiếu từ các việc được giao đã chốt trong năm của đơn vị (ADR-030 mục 4).
 * Chỉ để người chấm đối chiếu và để kiểm điều kiện xếp loại, không tự quy ra điểm.
 */
export interface UnitMetrics {
  /** Tổng số việc được giao của cán bộ thuộc đơn vị trong năm. */
  works: number;
  /** Việc đã hoàn thành đủ số lượng được giao. */
  completed: number;
  /** Việc hoàn thành đủ số lượng và không có lần chậm nào. */
  onTime: number;
  /** Việc hoàn thành vượt số lượng được giao. */
  exceeded: number;
  /** Việc có ít nhất một lần chậm tiến độ. */
  late: number;
}

export interface UnitEvaluationModel {
  id: string;
  periodId: string;
  unitId: string;
  status: EvaluationStatus;
  selfGeneralScore: number | null;
  selfResultScore: number | null;
  selfComment: string | null;
  selfSubmittedAt: Date | null;
  /** Điểm tiêu chí chung (0–30), do người thẩm định chấm. */
  generalScore: number | null;
  /** Điểm kết quả thực hiện nhiệm vụ (0–70), do người thẩm định chấm. */
  resultScore: number | null;
  reviewComment: string | null;
  reviewerAccountId: string | null;
  reviewedAt: Date | null;
  approverAccountId: string | null;
  approvedAt: Date | null;
  approveComment: string | null;
  returnReason: string | null;
  totalScore: number | null;
  rating: Rating | null;
  /** Số liệu tham chiếu chụp lúc thẩm định, giữ nguyên sau khi phê duyệt. */
  metrics: UnitMetrics | null;
  /** Điểm từng trục khi tự chấm và khi thẩm định, kèm ảnh chụp định nghĩa trục (ADR-036); null khi nhập một số. */
  selfAxisScores: AxisScore[] | null;
  axisScores: AxisScore[] | null;
  createdBy: string | null;
}
export type NewUnitEvaluation = Pick<UnitEvaluationModel, 'periodId' | 'unitId' | 'createdBy'>;
export type UnitEvaluationPatch = Partial<Omit<UnitEvaluationModel, 'id' | 'periodId' | 'unitId' | 'createdBy'>>;

/** Đơn vị cùng người đứng đầu và các cán bộ đang giữ vị trí trong đơn vị. */
export interface UnitInfo {
  id: string;
  code: string;
  name: string;
  type: 'BAN' | 'PHONG';
  parentId: string | null;
  /** Người giữ vị trí cấp cao nhất của đơn vị; null nếu vị trí đó đang trống. */
  headPersonId: string | null;
  /** Vị trí cấp cao nhất của đơn vị (để biết phiếu của vị trí nào là phiếu của người đứng đầu; ADR-047). */
  headPositionId?: string | null;
  /** Cán bộ đang giữ vị trí trực tiếp trong đơn vị (không gồm đơn vị con). */
  memberPersonIds: string[];
}
