import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Cờ "lãnh đạo, quản lý" trên vị trí việc làm (ADR-022). Vị trí hiện có: bật nếu cấp 1 đến 4. */
export class PositionIsLeader1761100000000 implements MigrationInterface {
  name = 'PositionIsLeader1761100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "job_position" ADD COLUMN "is_leader" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`UPDATE "job_position" SET "is_leader" = ("level" <= 4)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "job_position" DROP COLUMN "is_leader"`);
  }
}
