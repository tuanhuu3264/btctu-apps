import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kiêm nhiệm (PLAN-A A2.1, ADR-047). Một cán bộ có tối đa một phân công CHÍNH đang hiệu lực và có thể có nhiều phân công
 * KIÊM NHIỆM cùng lúc. Chỉ ràng buộc "một vị trí một người" giữ nguyên. Dữ liệu cũ đều là phân công chính.
 */
export class ConcurrentAssignment1762600000000 implements MigrationInterface {
  name = 'ConcurrentAssignment1762600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assignment" ADD COLUMN "kind" character varying(12) NOT NULL DEFAULT 'PRIMARY'`);
    await queryRunner.query(`ALTER TABLE "assignment" ADD CONSTRAINT "CHK_assignment_kind" CHECK ("kind" IN ('PRIMARY', 'CONCURRENT'))`);
    await queryRunner.query(`DROP INDEX "UQ_assignment_person_open"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_assignment_person_open" ON "assignment" ("person_id") WHERE "valid_to" IS NULL AND "kind" = 'PRIMARY'`);
    await queryRunner.query(`CREATE INDEX "IDX_assignment_person" ON "assignment" ("person_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_assignment_person"`);
    await queryRunner.query(`DROP INDEX "UQ_assignment_person_open"`);
    await queryRunner.query(`DELETE FROM "assignment" WHERE "kind" = 'CONCURRENT'`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_assignment_person_open" ON "assignment" ("person_id") WHERE "valid_to" IS NULL`);
    await queryRunner.query(`ALTER TABLE "assignment" DROP CONSTRAINT "CHK_assignment_kind"`);
    await queryRunner.query(`ALTER TABLE "assignment" DROP COLUMN "kind"`);
  }
}
