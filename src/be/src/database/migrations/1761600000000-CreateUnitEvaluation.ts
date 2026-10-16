import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hồ sơ đánh giá, xếp loại tập thể theo năm (ADR-030) và vai trò đại diện Ban Thường vụ.
 * Trigger khóa hồ sơ đã phê duyệt giống hồ sơ cá nhân (ADR-014).
 */
export class CreateUnitEvaluation1761600000000 implements MigrationInterface {
  name = 'CreateUnitEvaluation1761600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "account_role" DROP CONSTRAINT "CHK_account_role_role"`);
    await queryRunner.query(`
      ALTER TABLE "account_role" ADD CONSTRAINT "CHK_account_role_role" CHECK ("role" IN (
        'TRUONG_BAN', 'PHO_TRUONG_BAN', 'TRUONG_PHO_PHONG', 'CHUYEN_VIEN',
        'VAN_PHONG', 'QUAN_TRI_HE_THONG', 'QUAN_TRI_DU_LIEU', 'DAI_DIEN_THUONG_VU'
      ))
    `);

    await queryRunner.query(`
      CREATE TABLE "unit_evaluation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "period_id" uuid NOT NULL,
        "unit_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'PLANNED',
        "self_general_score" numeric(5,2),
        "self_result_score" numeric(5,2),
        "self_comment" text,
        "self_submitted_at" TIMESTAMP WITH TIME ZONE,
        "general_score" numeric(5,2),
        "result_score" numeric(5,2),
        "review_comment" text,
        "reviewer_account_id" uuid,
        "reviewed_at" TIMESTAMP WITH TIME ZONE,
        "approver_account_id" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "approve_comment" text,
        "return_reason" text,
        "total_score" numeric(5,2),
        "rating" character varying(20),
        "metrics" jsonb,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unit_evaluation" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_unit_evaluation_period_unit" UNIQUE ("period_id", "unit_id"),
        CONSTRAINT "CHK_unit_evaluation_status" CHECK ("status" IN ('PLANNED', 'SELF_SUBMITTED', 'REVIEWED', 'APPROVED')),
        CONSTRAINT "CHK_unit_evaluation_rating" CHECK ("rating" IS NULL OR "rating" IN ('XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH', 'KHONG_HOAN_THANH')),
        CONSTRAINT "CHK_unit_evaluation_general" CHECK ("general_score" IS NULL OR "general_score" BETWEEN 0 AND 30),
        CONSTRAINT "CHK_unit_evaluation_result" CHECK ("result_score" IS NULL OR "result_score" BETWEEN 0 AND 70),
        CONSTRAINT "CHK_unit_evaluation_self_general" CHECK ("self_general_score" IS NULL OR "self_general_score" BETWEEN 0 AND 30),
        CONSTRAINT "CHK_unit_evaluation_self_result" CHECK ("self_result_score" IS NULL OR "self_result_score" BETWEEN 0 AND 70),
        CONSTRAINT "FK_unit_evaluation_period" FOREIGN KEY ("period_id") REFERENCES "evaluation_period"("id"),
        CONSTRAINT "FK_unit_evaluation_unit" FOREIGN KEY ("unit_id") REFERENCES "unit"("id")
      )
    `);

    await queryRunner.query(`
      CREATE FUNCTION unit_evaluation_guard() RETURNS trigger AS $fn$
      BEGIN
        IF OLD.status = 'APPROVED' THEN
          RAISE EXCEPTION 'Hồ sơ đánh giá tập thể đã phê duyệt, không được sửa hoặc xóa';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER unit_evaluation_guard BEFORE UPDATE OR DELETE ON "unit_evaluation"
      FOR EACH ROW EXECUTE FUNCTION unit_evaluation_guard()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER unit_evaluation_guard ON "unit_evaluation"`);
    await queryRunner.query(`DROP FUNCTION unit_evaluation_guard()`);
    await queryRunner.query(`DROP TABLE "unit_evaluation"`);
    await queryRunner.query(`ALTER TABLE "account_role" DROP CONSTRAINT "CHK_account_role_role"`);
    await queryRunner.query(`
      ALTER TABLE "account_role" ADD CONSTRAINT "CHK_account_role_role" CHECK ("role" IN (
        'TRUONG_BAN', 'PHO_TRUONG_BAN', 'TRUONG_PHO_PHONG', 'CHUYEN_VIEN',
        'VAN_PHONG', 'QUAN_TRI_HE_THONG', 'QUAN_TRI_DU_LIEU'
      ))
    `);
  }
}
