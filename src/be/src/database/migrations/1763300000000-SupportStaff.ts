import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Người lao động làm công tác hỗ trợ, phục vụ (ADR-053; Sổ tay Bộ Nội vụ Chương III): cờ trên vị trí việc làm (không đồng
 * thời là lãnh đạo) và hai cột lưu ba tiêu chí chất lượng, tuân thủ quy trình, hiệu quả do người lao động tự đánh giá và do
 * người quản lý đánh giá. Trigger khóa hồ sơ đã phê duyệt bao cả hai cột mới.
 */
export class SupportStaff1763300000000 implements MigrationInterface {
  name = 'SupportStaff1763300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "job_position" ADD COLUMN "is_support" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "job_position" ADD CONSTRAINT "CHK_job_position_support_not_leader" CHECK (NOT ("is_support" AND "is_leader"))`);
    await queryRunner.query(`
      ALTER TABLE "evaluation"
        ADD COLUMN "self_support" jsonb,
        ADD COLUMN "support" jsonb,
        ADD CONSTRAINT "CHK_evaluation_self_support" CHECK ("self_support" IS NULL OR jsonb_typeof("self_support") = 'object'),
        ADD CONSTRAINT "CHK_evaluation_support" CHECK ("support" IS NULL OR jsonb_typeof("support") = 'object')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evaluation"
        DROP CONSTRAINT "CHK_evaluation_support",
        DROP CONSTRAINT "CHK_evaluation_self_support",
        DROP COLUMN "support",
        DROP COLUMN "self_support"
    `);
    await queryRunner.query(`ALTER TABLE "job_position" DROP CONSTRAINT "CHK_job_position_support_not_leader"`);
    await queryRunner.query(`ALTER TABLE "job_position" DROP COLUMN "is_support"`);
  }
}
