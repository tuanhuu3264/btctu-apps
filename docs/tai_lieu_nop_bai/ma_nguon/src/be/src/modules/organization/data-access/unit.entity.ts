import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type { OrgStatus, UnitType } from '../application/unit.model.js';

@Entity('unit')
export class UnitEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 16 })
  type: UnitType;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'varchar', length: 10, default: 'ACTIVE' })
  status: OrgStatus;

  @Column({ name: 'inactive_at', type: 'timestamptz', nullable: true })
  inactiveAt: Date | null;

  @Column({ name: 'inactive_reason', type: 'varchar', length: 500, nullable: true })
  inactiveReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
