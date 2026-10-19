import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { Role } from '../application/authorization.model.js';

@Entity('account_role')
export class AccountRoleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ type: 'varchar', length: 32 })
  role: Role;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom: Date;

  @Column({ name: 'valid_to', type: 'timestamptz', nullable: true })
  validTo: Date | null;

  @Column({ name: 'granted_by', type: 'uuid', nullable: true })
  grantedBy: string | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
