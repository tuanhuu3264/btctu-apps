import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Dòng chỉ tiêu của hồ sơ ghi tên các nhiệm vụ nguồn (ADR-018 mục 5). Trigger khóa hồ sơ đã phê duyệt vẫn áp dụng. */
export class EvaluationTaskTitles1760500000000 implements MigrationInterface {
  name = 'EvaluationTaskTitles1760500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "evaluation_task" ADD COLUMN "source_task_titles" text[] NOT NULL DEFAULT '{}'`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "evaluation_task" DROP COLUMN "source_task_titles"`);
  }
}
