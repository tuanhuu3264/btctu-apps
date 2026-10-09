import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhiệm vụ do cấp trên đặt cho từng cán bộ, chứa các công việc được giao (ADR-018). Việc đã giao từ trước
 * được gom vào một nhiệm vụ "Nhiệm vụ chung" của chính cán bộ đó. Khóa ngoại ghép bảo đảm công việc và nhiệm vụ
 * của nó cùng thuộc một cán bộ.
 */
export class CreateWorkTask1760400000000 implements MigrationInterface {
  name = 'CreateWorkTask1760400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "work_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assignee_person_id" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "description" text,
        "created_by_account_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_task" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_work_task_id_assignee" UNIQUE ("id", "assignee_person_id"),
        CONSTRAINT "CHK_work_task_title" CHECK (char_length(btrim("title")) >= 3),
        CONSTRAINT "FK_work_task_person" FOREIGN KEY ("assignee_person_id") REFERENCES "person"("id"),
        CONSTRAINT "FK_work_task_created_by" FOREIGN KEY ("created_by_account_id") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_work_task_assignee_title" ON "work_task" ("assignee_person_id", lower("title"))`);

    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "task_id" uuid`);
    await queryRunner.query(`
      INSERT INTO "work_task" ("assignee_person_id", "title")
      SELECT DISTINCT "assignee_person_id", 'Nhiệm vụ chung' FROM "work_assignment"
    `);
    await queryRunner.query(`
      UPDATE "work_assignment" a SET "task_id" = t."id"
      FROM "work_task" t WHERE t."assignee_person_id" = a."assignee_person_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "work_assignment"
        ALTER COLUMN "task_id" SET NOT NULL,
        ADD CONSTRAINT "FK_work_assignment_task" FOREIGN KEY ("task_id", "assignee_person_id")
          REFERENCES "work_task"("id", "assignee_person_id")
    `);
    await queryRunner.query(`CREATE INDEX "IDX_work_assignment_task" ON "work_assignment" ("task_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_work_assignment_task"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "FK_work_assignment_task", DROP COLUMN "task_id"`);
    await queryRunner.query(`DROP TABLE "work_task"`);
  }
}
