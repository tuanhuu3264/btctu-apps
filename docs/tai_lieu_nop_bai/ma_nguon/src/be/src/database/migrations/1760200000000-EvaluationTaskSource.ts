import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dòng chỉ tiêu của hồ sơ ghi nguồn gốc từ các việc được giao, số lần chậm và số lần chưa đạt (ADR-016).
 * Trigger khóa hồ sơ đã phê duyệt của ADR-014 vẫn áp dụng cho các cột mới.
 */
export class EvaluationTaskSource1760200000000 implements MigrationInterface {
  name = 'EvaluationTaskSource1760200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evaluation_task"
        ADD COLUMN "source_assignment_ids" uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN "late_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "rework_count" integer NOT NULL DEFAULT 0,
        ADD CONSTRAINT "CHK_evaluation_task_late" CHECK ("late_count" >= 0),
        ADD CONSTRAINT "CHK_evaluation_task_rework" CHECK ("rework_count" >= 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evaluation_task"
        DROP CONSTRAINT "CHK_evaluation_task_rework",
        DROP CONSTRAINT "CHK_evaluation_task_late",
        DROP COLUMN "rework_count",
        DROP COLUMN "late_count",
        DROP COLUMN "source_assignment_ids"
    `);
  }
}
