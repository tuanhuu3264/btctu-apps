import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhật ký chỉ ghi thêm (ADR-011 mục 7). Trigger chặn UPDATE, DELETE, TRUNCATE kể cả với chủ bảng.
 * Khi triển khai thật, tài khoản kết nối của ứng dụng còn phải bị thu quyền UPDATE/DELETE trên bảng
 * này và tài khoản chạy migration phải là tài khoản khác (GAP G-14).
 */
export class CreateAuditLog1759700000000 implements MigrationInterface {
  name = 'CreateAuditLog1759700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" bigserial NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "actor_account_id" uuid,
        "actor_username" character varying(64),
        "action" character varying(64) NOT NULL,
        "outcome" character varying(16) NOT NULL,
        "target_type" character varying(32),
        "target_id" character varying(64),
        "details" jsonb,
        "request_id" uuid,
        "ip" character varying(45),
        "prev_hash" character(64) NOT NULL,
        "hash" character(64) NOT NULL,
        CONSTRAINT "PK_audit_log_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_audit_log_hash" UNIQUE ("hash"),
        CONSTRAINT "CHK_audit_log_outcome" CHECK ("outcome" IN ('SUCCESS', 'DENIED', 'FAILURE'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_occurred_at" ON "audit_log" ("occurred_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_actor" ON "audit_log" ("actor_account_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_action" ON "audit_log" ("action")`);

    await queryRunner.query(`
      CREATE FUNCTION audit_log_block_change() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'audit_log chỉ được ghi thêm, không được sửa hoặc xóa';
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_no_update_delete BEFORE UPDATE OR DELETE ON "audit_log"
      FOR EACH ROW EXECUTE FUNCTION audit_log_block_change()
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_change()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER audit_log_no_truncate ON "audit_log"`);
    await queryRunner.query(`DROP TRIGGER audit_log_no_update_delete ON "audit_log"`);
    await queryRunner.query(`DROP FUNCTION audit_log_block_change()`);
    await queryRunner.query(`DROP TABLE "audit_log"`);
  }
}
