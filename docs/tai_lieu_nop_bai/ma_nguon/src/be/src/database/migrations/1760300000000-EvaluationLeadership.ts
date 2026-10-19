import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Điểm ba tiêu chí lãnh đạo, chỉ đạo (D) của cán bộ lãnh đạo, quản lý (ADR-017). Trigger khóa hồ sơ đã phê duyệt
 * của ADR-014 vẫn áp dụng cho cột mới.
 */
export class EvaluationLeadership1760300000000 implements MigrationInterface {
  name = 'EvaluationLeadership1760300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evaluation"
        ADD COLUMN "leadership" jsonb,
        ADD CONSTRAINT "CHK_evaluation_leadership" CHECK ("leadership" IS NULL OR jsonb_typeof("leadership") = 'object')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "evaluation" DROP CONSTRAINT "CHK_evaluation_leadership", DROP COLUMN "leadership"`);
  }
}
