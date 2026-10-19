import type { AxisDefinition } from '../unit-axes.js';

/**
 * Bộ trục cố định cho test: ba nhóm chung 10 và sáu trục kết quả 15, 20, 10, 10, 10, 5, có T2 gợi ý tự động. Tách khỏi
 * bộ mặc định thật (DEFAULT_AXES) để test về cơ chế chấm theo trục không đổi khi phân bổ điểm của bộ tiêu chí đổi.
 */
export const FIXTURE_AXES: readonly AxisDefinition[] = [
  { code: 'G1', name: 'Chấp hành đường lối, chỉ đạo', kind: 'GENERAL', maxPoints: 10, sortOrder: 10, autoMetric: null, active: true },
  { code: 'G2', name: 'Quản lý công chức, đoàn kết', kind: 'GENERAL', maxPoints: 10, sortOrder: 20, autoMetric: null, active: true },
  { code: 'G3', name: 'Cải cách hành chính, chuyển đổi số', kind: 'GENERAL', maxPoints: 10, sortOrder: 30, autoMetric: null, active: true },
  { code: 'T1', name: 'Tham mưu văn bản', kind: 'RESULT', maxPoints: 15, sortOrder: 110, autoMetric: null, active: true },
  { code: 'T2', name: 'Hoàn thành chương trình, kế hoạch năm', kind: 'RESULT', maxPoints: 20, sortOrder: 120, autoMetric: 'COMPLETED_SHARE', active: true },
  { code: 'T3', name: 'Quản lý, điều hành', kind: 'RESULT', maxPoints: 10, sortOrder: 130, autoMetric: null, active: true },
  { code: 'T4', name: 'Phối hợp, sáng kiến', kind: 'RESULT', maxPoints: 10, sortOrder: 140, autoMetric: null, active: true },
  { code: 'T5', name: 'Chuyển đổi số', kind: 'RESULT', maxPoints: 10, sortOrder: 150, autoMetric: null, active: true },
  { code: 'T6', name: 'Giải quyết đơn thư', kind: 'RESULT', maxPoints: 5, sortOrder: 160, autoMetric: null, active: true },
];
