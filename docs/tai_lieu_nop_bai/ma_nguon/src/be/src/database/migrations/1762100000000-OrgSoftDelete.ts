import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Xóa mềm đơn vị và vị trí việc làm (PLAN-A A1): "xóa" chỉ đổi trạng thái sang INACTIVE, dữ liệu lịch sử được giữ. */
export class OrgSoftDelete1762100000000 implements MigrationInterface {
  name = 'OrgSoftDelete1762100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['unit', 'job_position']) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN "status" character varying(10) NOT NULL DEFAULT 'ACTIVE'`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN "inactive_at" TIMESTAMP WITH TIME ZONE`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN "inactive_reason" character varying(500)`);
      await queryRunner.query(`ALTER TABLE "${table}" ADD CONSTRAINT "CHK_${table}_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE'))`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['unit', 'job_position']) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT "CHK_${table}_status"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "inactive_reason"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "inactive_at"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN "status"`);
    }
  }
}
