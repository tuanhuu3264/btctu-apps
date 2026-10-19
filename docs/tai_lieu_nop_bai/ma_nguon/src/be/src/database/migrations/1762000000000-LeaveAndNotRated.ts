import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Miễn tháng vì nghỉ và hồ sơ năm không xếp loại (ADR-039): bảng tháng nghỉ có căn cứ và cột lý do không xếp loại.
 */
export class LeaveAndNotRated1762000000000 implements MigrationInterface {
  name = 'LeaveAndNotRated1762000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "leave_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "person_id" uuid NOT NULL,
        "year" smallint NOT NULL,
        "month" smallint NOT NULL,
        "reason" character varying(12) NOT NULL,
        "note" text,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leave_record" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_leave_record_person_month" UNIQUE ("person_id", "year", "month"),
        CONSTRAINT "FK_leave_record_person" FOREIGN KEY ("person_id") REFERENCES "person"("id"),
        CONSTRAINT "CHK_leave_record_month" CHECK ("month" BETWEEN 1 AND 12),
        CONSTRAINT "CHK_leave_record_reason" CHECK ("reason" IN ('OM', 'THAI_SAN', 'KHONG_LUONG', 'KHAC'))
      )
    `);
    await queryRunner.query(`ALTER TABLE "evaluation" ADD COLUMN "not_rated_reason" text`);
    // Hồ sơ năm không xếp loại được phê duyệt mà không có điểm và xếp loại (Điều 11.1): chỉ khi có lý do ghi rõ.
    await queryRunner.query(`ALTER TABLE "evaluation" DROP CONSTRAINT "CHK_evaluation_reviewed_fields"`);
    await queryRunner.query(`
      ALTER TABLE "evaluation" ADD CONSTRAINT "CHK_evaluation_reviewed_fields" CHECK (
        "status" NOT IN ('REVIEWED', 'APPROVED') OR (
          "reviewer_account_id" IS NOT NULL AND "reviewed_at" IS NOT NULL AND (
            ("general_score" IS NOT NULL AND "result_score" IS NOT NULL AND "total_score" IS NOT NULL AND "rating" IS NOT NULL)
            OR ("status" = 'APPROVED' AND "not_rated_reason" IS NOT NULL AND "total_score" IS NULL AND "rating" IS NULL)
          )
        )
      )
    `);
    await queryRunner.query(`ALTER TABLE "evaluation" ADD CONSTRAINT "CHK_evaluation_not_rated" CHECK ("not_rated_reason" IS NULL OR "status" = 'APPROVED')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "evaluation" DROP CONSTRAINT "CHK_evaluation_not_rated"`);
    await queryRunner.query(`ALTER TABLE "evaluation" DROP CONSTRAINT "CHK_evaluation_reviewed_fields"`);
    await queryRunner.query(`
      ALTER TABLE "evaluation" ADD CONSTRAINT "CHK_evaluation_reviewed_fields" CHECK (
        "status" NOT IN ('REVIEWED', 'APPROVED') OR (
          "general_score" IS NOT NULL AND "result_score" IS NOT NULL AND "total_score" IS NOT NULL AND
          "rating" IS NOT NULL AND "reviewer_account_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
        )
      ) NOT VALID
    `);
    await queryRunner.query(`ALTER TABLE "evaluation" DROP COLUMN "not_rated_reason"`);
    await queryRunner.query(`DROP TABLE "leave_record"`);
  }
}
