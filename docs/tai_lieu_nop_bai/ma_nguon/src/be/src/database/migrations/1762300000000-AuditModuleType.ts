import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhật ký có `module` và `type` (PLAN-A A5, ADR-045). Bảng chỉ được ghi thêm (trigger chặn UPDATE), nên bản ghi cũ
 * không được điền lại: để NULL và `hash_version = 1` (mã băm cũ không gồm hai trường này). Khi đọc, bản ghi cũ được
 * suy module và type từ `action`. Bản ghi mới có `hash_version = 2`, hai trường nằm trong mã băm.
 */
export class AuditModuleType1762300000000 implements MigrationInterface {
  name = 'AuditModuleType1762300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "audit_log" ADD COLUMN "module" character varying(32)`);
    await queryRunner.query(`ALTER TABLE "audit_log" ADD COLUMN "type" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "audit_log" ADD COLUMN "hash_version" smallint NOT NULL DEFAULT 1`);
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "CHK_audit_log_type" CHECK ("type" IS NULL OR "type" IN ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'APPROVE', 'LOGIN', 'EXPORT', 'ACCESS', 'REVIEW', 'OTHER'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_log" ADD CONSTRAINT "CHK_audit_log_hash_version" CHECK (("hash_version" = 1) OR ("hash_version" >= 2 AND "module" IS NOT NULL AND "type" IS NOT NULL))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_module_type" ON "audit_log" ("module", "type")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_target" ON "audit_log" ("target_type", "target_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_log_target"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_log_module_type"`);
    await queryRunner.query(`ALTER TABLE "audit_log" DROP CONSTRAINT "CHK_audit_log_hash_version"`);
    await queryRunner.query(`ALTER TABLE "audit_log" DROP CONSTRAINT "CHK_audit_log_type"`);
    await queryRunner.query(`ALTER TABLE "audit_log" DROP COLUMN "hash_version"`);
    await queryRunner.query(`ALTER TABLE "audit_log" DROP COLUMN "type"`);
    await queryRunner.query(`ALTER TABLE "audit_log" DROP COLUMN "module"`);
  }
}
