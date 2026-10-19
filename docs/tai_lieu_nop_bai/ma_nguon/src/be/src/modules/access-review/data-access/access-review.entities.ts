import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { ReviewDecision, ReviewerKind, ReviewStatus } from '../application/access-review.model.js';

@Entity('access_review')
export class AccessReviewEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'smallint' })
  year: number;

  @Column({ type: 'smallint' })
  quarter: number;

  @Column({ type: 'varchar', length: 40 })
  label: string;

  @Column({ type: 'varchar', length: 10, default: 'OPEN' })
  status: ReviewStatus;

  /** PostgreSQL `date` được trả về dạng chuỗi YYYY-MM-DD. */
  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;
}

@Entity('access_review_item')
export class AccessReviewItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ type: 'varchar', length: 64 })
  username: string;

  @Column({ name: 'person_id', type: 'uuid', nullable: true })
  personId: string | null;

  @Column({ name: 'person_name', type: 'varchar', length: 150, nullable: true })
  personName: string | null;

  @Column({ name: 'unit_name', type: 'varchar', length: 255, nullable: true })
  unitName: string | null;

  @Column({ name: 'position_title', type: 'varchar', length: 160, nullable: true })
  positionTitle: string | null;

  @Column({ type: 'varchar', length: 32 })
  role: string;

  @Column({ name: 'role_assignment_id', type: 'uuid' })
  roleAssignmentId: string;

  @Column({ name: 'role_valid_from', type: 'timestamptz' })
  roleValidFrom: Date;

  @Column({ name: 'role_valid_to', type: 'timestamptz', nullable: true })
  roleValidTo: Date | null;

  @Column({ name: 'reviewer_kind', type: 'varchar', length: 12 })
  reviewerKind: ReviewerKind;

  @Column({ name: 'reviewer_person_id', type: 'uuid', nullable: true })
  reviewerPersonId: string | null;

  @Column({ name: 'reviewer_name', type: 'varchar', length: 150, nullable: true })
  reviewerName: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  decision: ReviewDecision | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'revoke_applied', type: 'boolean', default: false })
  revokeApplied: boolean;
}
