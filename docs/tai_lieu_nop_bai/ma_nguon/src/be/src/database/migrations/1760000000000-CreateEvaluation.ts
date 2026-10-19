import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kỳ đánh giá, hồ sơ đánh giá, chỉ tiêu (ADR-014). Trigger khóa hồ sơ đã phê duyệt: không sửa hay xóa hồ sơ,
 * không thêm, sửa, xóa chỉ tiêu của hồ sơ đó.
 */
export class CreateEvaluation1760000000000 implements MigrationInterface {
  name = 'CreateEvaluation1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "evaluation_period" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "type" character varying(8) NOT NULL,
        "year" smallint NOT NULL,
        "number" smallint,
        "label" character varying(12) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "catalog_version_id" uuid NOT NULL,
        "status" character varying(8) NOT NULL DEFAULT 'OPEN',
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_evaluation_period" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_evaluation_period_label" UNIQUE ("label"),
        CONSTRAINT "CHK_evaluation_period_type" CHECK ("type" IN ('MONTH', 'QUARTER', 'YEAR')),
        CONSTRAINT "CHK_evaluation_period_number" CHECK (
          ("type" = 'YEAR' AND "number" IS NULL) OR
          ("type" = 'MONTH' AND "number" BETWEEN 1 AND 12) OR
          ("type" = 'QUARTER' AND "number" BETWEEN 1 AND 3)
        ),
        CONSTRAINT "CHK_evaluation_period_dates" CHECK ("end_date" >= "start_date"),
        CONSTRAINT "CHK_evaluation_period_status" CHECK ("status" IN ('OPEN', 'CLOSED')),
        CONSTRAINT "FK_evaluation_period_catalog" FOREIGN KEY ("catalog_version_id") REFERENCES "catalog_version"("id"),
        CONSTRAINT "FK_evaluation_period_created_by" FOREIGN KEY ("created_by") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_evaluation_period_key" ON "evaluation_period" ("type", "year", COALESCE("number", 0))`,
    );

    await queryRunner.query(`
      CREATE TABLE "evaluation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "period_id" uuid NOT NULL,
        "person_id" uuid NOT NULL,
        "position_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'PLANNED',
        "self_general_score" numeric(5,2),
        "self_comment" text,
        "self_submitted_at" TIMESTAMP WITH TIME ZONE,
        "general_score" numeric(5,2),
        "review_comment" text,
        "reviewer_account_id" uuid,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "approver_account_id" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "approve_comment" text,
        "return_reason" text,
        "result_score" numeric(5,2),
        "total_score" numeric(5,2),
        "rating" character varying(20),
        "scoring_params" jsonb,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_evaluation" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_evaluation_period_person" UNIQUE ("period_id", "person_id"),
        CONSTRAINT "CHK_evaluation_status" CHECK ("status" IN ('PLANNED', 'SELF_SUBMITTED', 'REVIEWED', 'APPROVED')),
        CONSTRAINT "CHK_evaluation_self_general" CHECK ("self_general_score" IS NULL OR "self_general_score" BETWEEN 0 AND 30),
        CONSTRAINT "CHK_evaluation_general" CHECK ("general_score" IS NULL OR "general_score" BETWEEN 0 AND 30),
        CONSTRAINT "CHK_evaluation_result" CHECK ("result_score" IS NULL OR "result_score" BETWEEN 0 AND 70),
        CONSTRAINT "CHK_evaluation_total" CHECK ("total_score" IS NULL OR "total_score" BETWEEN 0 AND 100),
        CONSTRAINT "CHK_evaluation_rating" CHECK (
          "rating" IS NULL OR "rating" IN ('XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH', 'KHONG_HOAN_THANH')
        ),
        CONSTRAINT "CHK_evaluation_reviewed_fields" CHECK (
          "status" NOT IN ('REVIEWED', 'APPROVED') OR (
            "general_score" IS NOT NULL AND "result_score" IS NOT NULL AND "total_score" IS NOT NULL AND
            "rating" IS NOT NULL AND "reviewer_account_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
          )
        ),
        CONSTRAINT "CHK_evaluation_approved_fields" CHECK (
          "status" <> 'APPROVED' OR ("approver_account_id" IS NOT NULL AND "approved_at" IS NOT NULL)
        ),
        CONSTRAINT "FK_evaluation_period" FOREIGN KEY ("period_id") REFERENCES "evaluation_period"("id"),
        CONSTRAINT "FK_evaluation_person" FOREIGN KEY ("person_id") REFERENCES "person"("id"),
        CONSTRAINT "FK_evaluation_position" FOREIGN KEY ("position_id") REFERENCES "job_position"("id"),
        CONSTRAINT "FK_evaluation_reviewer" FOREIGN KEY ("reviewer_account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_evaluation_approver" FOREIGN KEY ("approver_account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_evaluation_created_by" FOREIGN KEY ("created_by") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_evaluation_person" ON "evaluation" ("person_id")`);

    await queryRunner.query(`
      CREATE TABLE "evaluation_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "evaluation_id" uuid NOT NULL,
        "catalog_item_code" character varying(10) NOT NULL,
        "planned_quantity" integer NOT NULL,
        "completed_quantity" integer NOT NULL DEFAULT 0,
        "quality_level" smallint,
        "evidence" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_evaluation_task" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_evaluation_task_item" UNIQUE ("evaluation_id", "catalog_item_code"),
        CONSTRAINT "CHK_evaluation_task_planned" CHECK ("planned_quantity" BETWEEN 1 AND 100000),
        CONSTRAINT "CHK_evaluation_task_completed" CHECK ("completed_quantity" BETWEEN 0 AND 100000),
        CONSTRAINT "CHK_evaluation_task_quality" CHECK ("quality_level" IS NULL OR "quality_level" BETWEEN 1 AND 3),
        CONSTRAINT "FK_evaluation_task_evaluation" FOREIGN KEY ("evaluation_id") REFERENCES "evaluation"("id")
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION evaluation_guard() RETURNS trigger AS $fn$
      BEGIN
        IF OLD.status = 'APPROVED' THEN
          RAISE EXCEPTION 'Hồ sơ đánh giá đã phê duyệt, không được sửa hoặc xóa';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER evaluation_guard BEFORE UPDATE OR DELETE ON "evaluation"
      FOR EACH ROW EXECUTE FUNCTION evaluation_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION evaluation_task_guard() RETURNS trigger AS $fn$
      DECLARE
        v_status text;
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          SELECT status INTO v_status FROM evaluation WHERE id = OLD.evaluation_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Hồ sơ đánh giá đã phê duyệt, không được sửa chỉ tiêu';
          END IF;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          SELECT status INTO v_status FROM evaluation WHERE id = NEW.evaluation_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Hồ sơ đánh giá đã phê duyệt, không được sửa chỉ tiêu';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER evaluation_task_guard BEFORE INSERT OR UPDATE OR DELETE ON "evaluation_task"
      FOR EACH ROW EXECUTE FUNCTION evaluation_task_guard()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER evaluation_task_guard ON "evaluation_task"`);
    await queryRunner.query(`DROP FUNCTION evaluation_task_guard()`);
    await queryRunner.query(`DROP TRIGGER evaluation_guard ON "evaluation"`);
    await queryRunner.query(`DROP FUNCTION evaluation_guard()`);
    await queryRunner.query(`DROP TABLE "evaluation_task"`);
    await queryRunner.query(`DROP TABLE "evaluation"`);
    await queryRunner.query(`DROP TABLE "evaluation_period"`);
  }
}
