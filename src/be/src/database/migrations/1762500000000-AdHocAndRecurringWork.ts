import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Việc đột xuất và việc lặp định kỳ (PLAN-A A3, ADR-046).
 * - `work_assignment.source`: CATALOG (từ danh mục) hoặc AD_HOC (đột xuất, mã ảo X.L1..X.L4 theo mức độ khó, có `title`).
 * - Trạng thái mới PROPOSED: cán bộ đề xuất việc đột xuất, chờ cấp trên duyệt (chưa tính vào hồ sơ kỳ).
 * - `recurring_template`: mẫu lặp; việc sinh ra mang `recurring_template_id` và `recurring_key` (ngày của lần lặp), duy nhất theo cặp
 *   nên chạy lại bộ sinh việc không bao giờ sinh trùng.
 */
export class AdHocAndRecurringWork1762500000000 implements MigrationInterface {
  name = 'AdHocAndRecurringWork1762500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "recurring_template" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assignee_person_id" uuid NOT NULL,
        "task_id" uuid NOT NULL,
        "source" character varying(8) NOT NULL DEFAULT 'CATALOG',
        "catalog_item_code" character varying(10) NOT NULL,
        "title" character varying(200),
        "planned_quantity" integer NOT NULL,
        "frequency" character varying(10) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date,
        "due_after_days" smallint NOT NULL,
        "period_mode" character varying(6) NOT NULL DEFAULT 'AUTO',
        "report_kinds" text[] NOT NULL,
        "note" text,
        "approver_person_id" uuid,
        "status" character varying(10) NOT NULL DEFAULT 'ACTIVE',
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "inactive_at" TIMESTAMP WITH TIME ZONE,
        "last_run_at" TIMESTAMP WITH TIME ZONE,
        "last_error" text,
        CONSTRAINT "PK_recurring_template" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_recurring_template_source" CHECK ("source" IN ('CATALOG', 'AD_HOC')),
        CONSTRAINT "CHK_recurring_template_adhoc" CHECK (
          ("source" = 'AD_HOC') = ("title" IS NOT NULL) AND ("source" = 'AD_HOC') = ("catalog_item_code" ~ '^X\\.L[1-4]$')
        ),
        CONSTRAINT "CHK_recurring_template_planned" CHECK ("planned_quantity" BETWEEN 1 AND 100000),
        CONSTRAINT "CHK_recurring_template_frequency" CHECK ("frequency" IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')),
        CONSTRAINT "CHK_recurring_template_due" CHECK ("due_after_days" BETWEEN 0 AND 366),
        CONSTRAINT "CHK_recurring_template_range" CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
        CONSTRAINT "CHK_recurring_template_mode" CHECK ("period_mode" IN ('AUTO', 'MANUAL')),
        CONSTRAINT "CHK_recurring_template_kinds" CHECK (
          cardinality("report_kinds") BETWEEN 1 AND 3 AND "report_kinds" <@ ARRAY['MONTH', 'QUARTER', 'YEAR']::text[]
        ),
        CONSTRAINT "CHK_recurring_template_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT "FK_recurring_template_person" FOREIGN KEY ("assignee_person_id") REFERENCES "person"("id"),
        CONSTRAINT "FK_recurring_template_task" FOREIGN KEY ("task_id", "assignee_person_id") REFERENCES "work_task"("id", "assignee_person_id"),
        CONSTRAINT "FK_recurring_template_approver" FOREIGN KEY ("approver_person_id") REFERENCES "person"("id"),
        CONSTRAINT "FK_recurring_template_creator" FOREIGN KEY ("created_by") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_recurring_template_assignee" ON "recurring_template" ("assignee_person_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_recurring_template_status" ON "recurring_template" ("status")`);

    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_status"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_status" CHECK ("status" IN ('PROPOSED', 'OPEN', 'CANCELLED'))`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "source" character varying(8) NOT NULL DEFAULT 'CATALOG'`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "title" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "recurring_template_id" uuid`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "recurring_key" character varying(10)`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_source" CHECK ("source" IN ('CATALOG', 'AD_HOC'))`);
    await queryRunner.query(`
      ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_adhoc" CHECK (
        ("source" = 'AD_HOC') = ("title" IS NOT NULL) AND ("source" = 'AD_HOC') = ("catalog_item_code" ~ '^X\\.L[1-4]$')
      )
    `);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_proposed" CHECK ("status" <> 'PROPOSED' OR "source" = 'AD_HOC')`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_recurring" CHECK (("recurring_template_id" IS NULL) = ("recurring_key" IS NULL))`);
    await queryRunner.query(
      `ALTER TABLE "work_assignment" ADD CONSTRAINT "FK_work_assignment_recurring" FOREIGN KEY ("recurring_template_id") REFERENCES "recurring_template"("id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_work_assignment_recurring" ON "work_assignment" ("recurring_template_id", "recurring_key") WHERE "recurring_template_id" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_work_assignment_recurring"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "FK_work_assignment_recurring"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_recurring"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_proposed"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_adhoc"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_source"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "recurring_key"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "recurring_template_id"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "title"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "source"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_status"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_status" CHECK ("status" IN ('OPEN', 'CANCELLED'))`);
    await queryRunner.query(`DROP TABLE "recurring_template"`);
  }
}
