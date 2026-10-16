import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Xóa mềm nhiệm vụ và công việc trong danh mục (PLAN-A A1.6): "xóa" chỉ đổi trạng thái sang INACTIVE. */
export class CatalogSoftDelete1762200000000 implements MigrationInterface {
  name = 'CatalogSoftDelete1762200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['catalog_task', 'catalog_item']) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN "status" character varying(10) NOT NULL DEFAULT 'ACTIVE'`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN "inactive_at" TIMESTAMP WITH TIME ZONE`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN "inactive_reason" character varying(500)`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['catalog_task', 'catalog_item']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "CHK_${table}_status"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "inactive_reason"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "inactive_at"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "status"`);
    }
  }
}
