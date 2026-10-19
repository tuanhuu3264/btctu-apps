import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Việc được giao và các lần báo cáo hoàn thành (ADR-016). Một lần báo cáo đã được xác nhận hoặc từ chối
 * thì không sửa, không xóa: đó là bằng chứng cho số lần chậm, số lần chưa đạt và số lượng đã tính.
 */
export class CreateTasking1760100000000 implements MigrationInterface {
  name = 'CreateTasking1760100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "work_assignment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assignee_person_id" uuid NOT NULL,
        "assigner_account_id" uuid,
        "catalog_item_code" character varying(10) NOT NULL,
        "catalog_version_id" uuid NOT NULL,
        "planned_quantity" integer NOT NULL,
        "due_date" date NOT NULL,
        "period_mode" character varying(6) NOT NULL,
        "report_kinds" text[] NOT NULL,
        "note" text,
        "status" character varying(10) NOT NULL DEFAULT 'OPEN',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_assignment" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_work_assignment_planned" CHECK ("planned_quantity" BETWEEN 1 AND 100000),
        CONSTRAINT "CHK_work_assignment_mode" CHECK ("period_mode" IN ('AUTO', 'MANUAL')),
        CONSTRAINT "CHK_work_assignment_kinds" CHECK (
          cardinality("report_kinds") BETWEEN 1 AND 3 AND "report_kinds" <@ ARRAY['MONTH', 'QUARTER', 'YEAR']::text[]
        ),
        CONSTRAINT "CHK_work_assignment_status" CHECK ("status" IN ('OPEN', 'CANCELLED')),
        CONSTRAINT "FK_work_assignment_person" FOREIGN KEY ("assignee_person_id") REFERENCES "person"("id"),
        CONSTRAINT "FK_work_assignment_assigner" FOREIGN KEY ("assigner_account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_work_assignment_catalog" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_work_assignment_assignee" ON "work_assignment" ("assignee_person_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_work_assignment_due" ON "work_assignment" ("due_date")`);

    await queryRunner.query(`
      CREATE TABLE "work_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assignment_id" uuid NOT NULL,
        "quantity" integer NOT NULL,
        "completed_on" date NOT NULL,
        "evidence" text,
        "status" character varying(10) NOT NULL DEFAULT 'REPORTED',
        "reported_by" uuid,
        "reported_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "decided_by" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decision_note" text,
        CONSTRAINT "PK_work_progress" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_work_progress_quantity" CHECK ("quantity" BETWEEN 1 AND 100000),
        CONSTRAINT "CHK_work_progress_status" CHECK ("status" IN ('REPORTED', 'CONFIRMED', 'REJECTED')),
        CONSTRAINT "CHK_work_progress_decided" CHECK (
          "status" = 'REPORTED' OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL)
        ),
        CONSTRAINT "FK_work_progress_assignment" FOREIGN KEY ("assignment_id") REFERENCES "work_assignment"("id"),
        CONSTRAINT "FK_work_progress_reported_by" FOREIGN KEY ("reported_by") REFERENCES "account"("id"),
        CONSTRAINT "FK_work_progress_decided_by" FOREIGN KEY ("decided_by") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_work_progress_assignment" ON "work_progress" ("assignment_id")`);

    await queryRunner.query(`
      CREATE FUNCTION work_progress_guard() RETURNS trigger AS $fn$
      BEGIN
        IF OLD.status <> 'REPORTED' THEN
          RAISE EXCEPTION 'Lần báo cáo đã được xử lý, không được sửa hoặc xóa';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER work_progress_guard BEFORE UPDATE OR DELETE ON "work_progress"
      FOR EACH ROW EXECUTE FUNCTION work_progress_guard()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER work_progress_guard ON "work_progress"`);
    await queryRunner.query(`DROP FUNCTION work_progress_guard()`);
    await queryRunner.query(`DROP TABLE "work_progress"`);
    await queryRunner.query(`DROP TABLE "work_assignment"`);
  }
}
