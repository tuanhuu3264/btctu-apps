import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hạn hoàn thành đánh giá năm và khiếu nại, phản ánh về tập thể (ADR-038):
 * cột gia hạn trên kỳ đánh giá (mặc định 15/12 khi để trống) và bảng ghi nhận khiếu nại chặn việc công nhận xếp loại.
 */
export class RatingDeadlineAndComplaints1761900000000 implements MigrationInterface {
  name = 'RatingDeadlineAndComplaints1761900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "evaluation_period" ADD COLUMN "rating_deadline" date`);
    await queryRunner.query(`
      CREATE TABLE "unit_complaint" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "unit_id" uuid NOT NULL,
        "period_id" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "content" text NOT NULL,
        "source" character varying(200),
        "received_on" date NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'RECEIVED',
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "assignee" character varying(200),
        "verify_due" date,
        "verify_directed_by" uuid,
        "verify_directed_at" TIMESTAMP WITH TIME ZONE,
        "outcome" character varying(16),
        "conclusion" text,
        "closed_by" uuid,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_unit_complaint" PRIMARY KEY ("id"),
        CONSTRAINT "FK_unit_complaint_unit" FOREIGN KEY ("unit_id") REFERENCES "unit"("id"),
        CONSTRAINT "FK_unit_complaint_period" FOREIGN KEY ("period_id") REFERENCES "evaluation_period"("id"),
        CONSTRAINT "CHK_unit_complaint_kind" CHECK ("kind" IN ('KHIEU_NAI', 'TO_CAO', 'PHAN_ANH', 'MAT_DOAN_KET')),
        CONSTRAINT "CHK_unit_complaint_status" CHECK ("status" IN ('RECEIVED', 'VERIFYING', 'CLOSED')),
        CONSTRAINT "CHK_unit_complaint_outcome" CHECK ("outcome" IS NULL OR "outcome" IN ('SUBSTANTIATED', 'UNFOUNDED')),
        CONSTRAINT "CHK_unit_complaint_closed" CHECK (("status" = 'CLOSED') = ("outcome" IS NOT NULL AND "conclusion" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_unit_complaint_unit_period" ON "unit_complaint" ("unit_id", "period_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "unit_complaint"`);
    await queryRunner.query(`ALTER TABLE "evaluation_period" DROP COLUMN "rating_deadline"`);
  }
}
