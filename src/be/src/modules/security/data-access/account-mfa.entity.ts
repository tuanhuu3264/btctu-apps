import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('account_mfa')
export class AccountMfaEntity {
  @PrimaryColumn({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'secret_enc', type: 'text' })
  secretEnc: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ name: 'recovery_hashes', type: 'text', array: true, default: () => "'{}'" })
  recoveryHashes: string[];

  /** bigint trả về chuỗi từ pg; chuyển sang số ở lớp truy cập. */
  @Column({ name: 'last_step', type: 'bigint', nullable: true })
  lastStep: string | null;

  @Column({ name: 'enabled_at', type: 'timestamptz', nullable: true })
  enabledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
