import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Xác thực nhiều lớp bằng mã TOTP (GAP G-12, ADR-048): mỗi tài khoản có tối đa một thiết bị.
 * Khóa lưu dạng mã hóa; mã khôi phục lưu dạng băm; `last_step` chặn dùng lại một mã.
 */
export class AccountMfa1762800000000 implements MigrationInterface {
  name = 'AccountMfa1762800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "account_mfa" (
        "account_id" uuid PRIMARY KEY REFERENCES "account"("id"),
        "secret_enc" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "recovery_hashes" text[] NOT NULL DEFAULT '{}',
        "last_step" bigint,
        "enabled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_mfa"`);
  }
}
