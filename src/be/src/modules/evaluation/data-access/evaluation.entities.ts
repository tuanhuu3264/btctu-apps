import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Rating } from '../../scoring/index.js';
import type { EvaluationStatus, PeriodStatus, PeriodType } from '../application/evaluation.model.js';
import type { AutoMetric, AxisKind, AxisScore } from '../application/unit-axes.js';
import type { ComplaintKind, ComplaintOutcome, ComplaintStatus } from '../application/unit-complaint.js';
import type { LeaveReason } from '../application/leave.js';
import type { GeneralCriteriaSet, GeneralMarks } from '../application/general-criteria.js';
import type { DisciplineForm, DisciplineReason, DisciplineSystem, RatingEventKind } from '../application/rating-events.js';
import type { UnitMetrics } from '../application/unit-evaluation.model.js';

/** PostgreSQL trả numeric dạng chuỗi; chuyển về số (hoặc null) khi đọc. */
const numeric = {
  to: (v: number | null | undefined) => v ?? null,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('evaluation_period')
export class EvaluationPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 8 })
  type: PeriodType;

  @Column({ type: 'smallint' })
  year: number;

  @Column({ type: 'smallint', nullable: true })
  number: number | null;

  @Column({ type: 'varchar', length: 12, unique: true })
  label: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ name: 'catalog_version_id', type: 'uuid' })
  catalogVersionId: string;

  @Column({ type: 'varchar', length: 8, default: 'OPEN' })
  status: PeriodStatus;

  @Column({ name: 'rating_deadline', type: 'date', nullable: true })
  ratingDeadline: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('evaluation')
export class EvaluationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'period_id', type: 'uuid' })
  periodId: string;

  @Column({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Column({ name: 'position_id', type: 'uuid' })
  positionId: string;

  @Column({ type: 'varchar', length: 16, default: 'PLANNED' })
  status: EvaluationStatus;

  @Column({ name: 'self_general_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  selfGeneralScore: number | null;

  @Column({ name: 'self_comment', type: 'text', nullable: true })
  selfComment: string | null;

  @Column({ name: 'self_submitted_at', type: 'timestamptz', nullable: true })
  selfSubmittedAt: Date | null;

  @Column({ name: 'general_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  generalScore: number | null;

  @Column({ name: 'review_comment', type: 'text', nullable: true })
  reviewComment: string | null;

  @Column({ name: 'reviewer_account_id', type: 'uuid', nullable: true })
  reviewerAccountId: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'approver_account_id', type: 'uuid', nullable: true })
  approverAccountId: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approve_comment', type: 'text', nullable: true })
  approveComment: string | null;

  @Column({ name: 'return_reason', type: 'text', nullable: true })
  returnReason: string | null;

  @Column({ name: 'not_rated_reason', type: 'text', nullable: true })
  notRatedReason: string | null;

  @Column({ name: 'result_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  resultScore: number | null;

  @Column({ name: 'total_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  totalScore: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rating: Rating | null;

  @Column({ name: 'scoring_params', type: 'jsonb', nullable: true })
  scoringParams: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  leadership: { unitResult: number; organizing: number; solidarity: number } | null;

  @Column({ name: 'self_support', type: 'jsonb', nullable: true })
  selfSupport: { quality: number; compliance: number; efficiency: number } | null;

  @Column({ type: 'jsonb', nullable: true })
  support: { quality: number; compliance: number; efficiency: number } | null;

  @Column({ name: 'self_general', type: 'jsonb', nullable: true })
  selfGeneral: GeneralMarks | null;

  @Column({ type: 'jsonb', nullable: true })
  general: GeneralMarks | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Phiên bản bảng tiêu chí chung của cá nhân, áp dụng từ một tháng (ADR-054). */
@Entity('general_criteria_version')
export class GeneralCriteriaVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'effective_from', type: 'date', unique: true })
  effectiveFrom: string;

  @Column({ type: 'jsonb' })
  leader: GeneralCriteriaSet;

  @Column({ type: 'jsonb' })
  staff: GeneralCriteriaSet;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

/** Sự kiện ảnh hưởng xếp loại cá nhân: kỷ luật, kết luận suy thoái, tín nhiệm thấp, tham nhũng trong phạm vi quản lý (ADR-055). */
@Entity('rating_event')
export class RatingEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Column({ type: 'varchar', length: 24 })
  kind: RatingEventKind;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate: string;

  @Column({ name: 'decision_no', type: 'varchar', length: 100 })
  decisionNo: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  form: DisciplineForm | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  system: DisciplineSystem | null;

  @Column({ type: 'varchar', length: 12, nullable: true })
  reason: DisciplineReason | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('evaluation_task')
export class EvaluationTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'evaluation_id', type: 'uuid' })
  evaluationId: string;

  @Column({ name: 'catalog_item_code', type: 'varchar', length: 10 })
  catalogItemCode: string;

  @Column({ name: 'planned_quantity', type: 'int' })
  plannedQuantity: number;

  @Column({ name: 'completed_quantity', type: 'int', default: 0 })
  completedQuantity: number;

  @Column({ name: 'quality_level', type: 'smallint', nullable: true })
  qualityLevel: number | null;

  @Column({ type: 'text', nullable: true })
  evidence: string | null;

  @Column({ name: 'source_assignment_ids', type: 'uuid', array: true, default: () => "'{}'" })
  sourceAssignmentIds: string[];

  @Column({ name: 'source_task_titles', type: 'text', array: true, default: () => "'{}'" })
  sourceTaskTitles: string[];

  @Column({ name: 'late_count', type: 'int', default: 0 })
  lateCount: number;

  @Column({ name: 'rework_count', type: 'int', default: 0 })
  reworkCount: number;

  @Column({ name: 'waived_late_count', type: 'int', default: 0 })
  waivedLateCount: number;

  @Column({ name: 'waived_rework_count', type: 'int', default: 0 })
  waivedReworkCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('unit_evaluation')
export class UnitEvaluationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'period_id', type: 'uuid' })
  periodId: string;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Column({ type: 'varchar', length: 16, default: 'PLANNED' })
  status: EvaluationStatus;

  @Column({ name: 'self_general_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  selfGeneralScore: number | null;

  @Column({ name: 'self_result_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  selfResultScore: number | null;

  @Column({ name: 'self_comment', type: 'text', nullable: true })
  selfComment: string | null;

  @Column({ name: 'self_submitted_at', type: 'timestamptz', nullable: true })
  selfSubmittedAt: Date | null;

  @Column({ name: 'general_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  generalScore: number | null;

  @Column({ name: 'result_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  resultScore: number | null;

  @Column({ name: 'review_comment', type: 'text', nullable: true })
  reviewComment: string | null;

  @Column({ name: 'reviewer_account_id', type: 'uuid', nullable: true })
  reviewerAccountId: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'approver_account_id', type: 'uuid', nullable: true })
  approverAccountId: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'approve_comment', type: 'text', nullable: true })
  approveComment: string | null;

  @Column({ name: 'return_reason', type: 'text', nullable: true })
  returnReason: string | null;

  @Column({ name: 'total_score', type: 'numeric', precision: 5, scale: 2, nullable: true, transformer: numeric })
  totalScore: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rating: Rating | null;

  @Column({ type: 'jsonb', nullable: true })
  metrics: UnitMetrics | null;

  @Column({ name: 'self_axis_scores', type: 'jsonb', nullable: true })
  selfAxisScores: AxisScore[] | null;

  @Column({ name: 'axis_scores', type: 'jsonb', nullable: true })
  axisScores: AxisScore[] | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Định nghĩa trục chấm điểm tập thể (ADR-036), thuộc bộ mặc định (`unitId` null) hoặc bộ riêng của một đơn vị (ADR-052). */
@Entity('unit_axis')
export class UnitAxisEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  @Column({ type: 'varchar', length: 10 })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 8 })
  kind: AxisKind;

  @Column({ name: 'max_points', type: 'numeric', precision: 5, scale: 2, transformer: numeric })
  maxPoints: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'auto_metric', type: 'varchar', length: 24, nullable: true })
  autoMetric: AutoMetric | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Khiếu nại, phản ánh về tập thể trong một kỳ năm (ADR-038). */
@Entity('unit_complaint')
export class UnitComplaintEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Column({ name: 'period_id', type: 'uuid' })
  periodId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: ComplaintKind;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  source: string | null;

  @Column({ name: 'received_on', type: 'date' })
  receivedOn: string;

  @Column({ type: 'varchar', length: 10, default: 'RECEIVED' })
  status: ComplaintStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'varchar', length: 200, nullable: true })
  assignee: string | null;

  @Column({ name: 'verify_due', type: 'date', nullable: true })
  verifyDue: string | null;

  @Column({ name: 'verify_directed_by', type: 'uuid', nullable: true })
  verifyDirectedBy: string | null;

  @Column({ name: 'verify_directed_at', type: 'timestamptz', nullable: true })
  verifyDirectedAt: Date | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  outcome: ComplaintOutcome | null;

  @Column({ type: 'text', nullable: true })
  conclusion: string | null;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}

/** Tháng nghỉ của cán bộ được miễn tính khi đánh giá năm (ADR-039). */
@Entity('leave_record')
export class LeaveRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Column({ type: 'smallint' })
  year: number;

  @Column({ type: 'smallint' })
  month: number;

  @Column({ type: 'varchar', length: 12 })
  reason: LeaveReason;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
