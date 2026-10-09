import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { Rating } from '../../scoring/index.js';
import type { EvaluationStatus, PeriodStatus, PeriodType } from '../application/evaluation.model.js';

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

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
