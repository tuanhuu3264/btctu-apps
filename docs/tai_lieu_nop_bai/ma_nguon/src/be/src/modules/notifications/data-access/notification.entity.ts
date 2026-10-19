import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { NotificationType } from '../../../common/notifier.js';

@Entity('notification')
export class NotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'recipient_person_id', type: 'uuid' })
  recipientPersonId: string;

  @Column({ type: 'varchar', length: 30 })
  type: NotificationType;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  link: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
