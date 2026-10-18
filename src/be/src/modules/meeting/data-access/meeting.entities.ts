import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { ActionStatus, AttendeeRole, MeetingStatus, Response, RoomStatus } from '../application/meeting.model.js';

@Entity('meeting')
export class MeetingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  agenda: string | null;

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'varchar', length: 300, nullable: true })
  location: string | null;

  @Column({ name: 'online_link', type: 'varchar', length: 500, nullable: true })
  onlineLink: string | null;

  @Column({ name: 'room_id', type: 'uuid', nullable: true })
  roomId: string | null;

  @Column({ name: 'organizer_person_id', type: 'uuid' })
  organizerPersonId: string;

  @Column({ name: 'created_by_account_id', type: 'uuid' })
  createdByAccountId: string;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'varchar', length: 10, default: 'SCHEDULED' })
  status: MeetingStatus;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @Column({ type: 'text', nullable: true })
  conclusion: string | null;

  @Column({ name: 'concluded_at', type: 'timestamptz', nullable: true })
  concludedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('meeting_room')
export class MeetingRoomEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'int', nullable: true })
  capacity: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 8, default: 'ACTIVE' })
  status: RoomStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('meeting_attendee')
export class MeetingAttendeeEntity {
  @PrimaryColumn({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @PrimaryColumn({ name: 'person_id', type: 'uuid' })
  personId: string;

  @Column({ type: 'varchar', length: 9 })
  role: AttendeeRole;

  @Column({ type: 'varchar', length: 8, default: 'PENDING' })
  response: Response;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'boolean', nullable: true })
  attended: boolean | null;
}

@Entity('meeting_action')
export class MeetingActionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'assignee_person_id', type: 'uuid' })
  assigneePersonId: string;

  @Column({ name: 'due_date', type: 'date' })
  dueDate: string;

  @Column({ type: 'varchar', length: 7, default: 'PENDING' })
  status: ActionStatus;

  @Column({ name: 'completed_on', type: 'date', nullable: true })
  completedOn: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('meeting_attachment')
export class MeetingAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

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
