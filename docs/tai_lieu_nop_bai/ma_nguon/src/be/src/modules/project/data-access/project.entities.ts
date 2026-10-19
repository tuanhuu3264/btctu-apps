import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { MemberRole, MilestoneStatus, ProjectKind, ProjectStatus } from '../application/project.model.js';

@Entity('project')
export class ProjectEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 6 })
  kind: ProjectKind;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  objective: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'owner_person_id', type: 'uuid' })
  ownerPersonId: string;

  @Column({ name: 'unit_id', type: 'uuid', nullable: true })
  unitId: string | null;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ type: 'varchar', length: 10, default: 'DRAFT' })
  status: ProjectStatus;

  @Column({ name: 'created_by_account_id', type: 'uuid' })
  createdByAccountId: string;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'approved_by_account_id', type: 'uuid', nullable: true })
  approvedByAccountId: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'return_reason', type: 'text', nullable: true })
  returnReason: string | null;

  @Column({ name: 'completed_on', type: 'date', nullable: true })
  completedOn: string | null;

  @Column({ name: 'close_note', type: 'text', nullable: true })
  closeNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('project_member')
export class ProjectMemberEntity {
  @PrimaryColumn({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @PrimaryColumn({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Column({ type: 'varchar', length: 6 })
  role: MemberRole;
}

@Entity('project_milestone')
export class ProjectMilestoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ type: 'int', default: 1 })
  weight: number;

  @Column({ name: 'assignee_person_id', type: 'uuid', nullable: true })
  assigneePersonId: string | null;

  @Column({ type: 'varchar', length: 7, default: 'PENDING' })
  status: MilestoneStatus;

  @Column({ name: 'completed_on', type: 'date', nullable: true })
  completedOn: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('project_attachment')
export class ProjectAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  @Column({ name: 'content_type', type: 'varchar', length: 120 })
  contentType: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes: number;

  @Column({ name: 'storage_key', type: 'varchar', length: 300 })
  storageKey: string;

  @Column({ name: 'uploaded_by_account_id', type: 'uuid' })
  uploadedByAccountId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
