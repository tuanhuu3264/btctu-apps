import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { AssignmentStatus, CommentKind, PeriodMode, ProgressStatus, ReportKind } from '../application/tasking.model.js';

@Entity('work_task')
export class WorkTaskEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignee_person_id', type: 'uuid' })
  assigneePersonId: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'created_by_account_id', type: 'uuid', nullable: true })
  createdByAccountId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('work_assignment')
export class WorkAssignmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'assignee_person_id', type: 'uuid' })
  assigneePersonId: string;

  @Column({ name: 'assigner_account_id', type: 'uuid', nullable: true })
  assignerAccountId: string | null;

  @Column({ name: 'catalog_item_code', type: 'varchar', length: 10 })
  catalogItemCode: string;

  @Column({ name: 'catalog_version_id', type: 'uuid' })
  catalogVersionId: string;

  @Column({ name: 'planned_quantity', type: 'int' })
  plannedQuantity: number;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ name: 'period_mode', type: 'varchar', length: 6 })
  periodMode: PeriodMode;

  @Column({ name: 'report_kinds', type: 'text', array: true })
  reportKinds: ReportKind[];

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'varchar', length: 10, default: 'OPEN' })
  status: AssignmentStatus;

  @Column({ name: 'approver_person_id', type: 'uuid', nullable: true })
  approverPersonId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('work_progress')
export class WorkProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'completed_on', type: 'date' })
  completedOn: string;

  @Column({ type: 'text', nullable: true })
  evidence: string | null;

  @Column({ type: 'varchar', length: 10, default: 'REPORTED' })
  status: ProgressStatus;

  @Column({ name: 'reported_by', type: 'uuid', nullable: true })
  reportedBy: string | null;

  @CreateDateColumn({ name: 'reported_at', type: 'timestamptz' })
  reportedAt: Date;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  @Column({ name: 'major_error', type: 'boolean', default: true })
  majorError: boolean;
}

@Entity('work_assignment_consultant')
export class WorkConsultantEntity {
  @PrimaryColumn({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @PrimaryColumn({ name: 'person_id', type: 'uuid' })
  personId: string;

  @CreateDateColumn({ name: 'added_at', type: 'timestamptz' })
  addedAt: Date;
}

@Entity('work_comment')
export class WorkCommentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @Column({ name: 'author_account_id', type: 'uuid' })
  authorAccountId: string;

  @Column({ name: 'author_person_id', type: 'uuid', nullable: true })
  authorPersonId: string | null;

  @Column({ type: 'varchar', length: 8, default: 'MESSAGE' })
  kind: CommentKind;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('work_attachment')
export class WorkAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'assignment_id', type: 'uuid' })
  assignmentId: string;

  @Column({ name: 'comment_id', type: 'uuid', nullable: true })
  commentId: string | null;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 120 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 255 })
  storageKey: string;

  @Column({ name: 'uploaded_by_account_id', type: 'uuid' })
  uploadedByAccountId: string;

  @CreateDateColumn({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;
}
