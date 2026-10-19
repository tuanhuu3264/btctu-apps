import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rà soát quyền định kỳ (ADR-044). `access_review_item` là ảnh chụp các vai trò đang có hiệu lực lúc tạo đợt:
 * tên đăng nhập, cán bộ, đơn vị, chức danh được lưu kèm để hồ sơ kiểm toán không đổi khi cơ cấu thay đổi sau đó.
 */
export class CreateAccessReview1762400000000 implements MigrationInterface {
  name = 'CreateAccessReview1762400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "access_review" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "year" smallint NOT NULL,
        "quarter" smallint NOT NULL,
        "label" character varying(40) NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'OPEN',
        "due_date" date NOT NULL,
        "note" text,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "closed_by" uuid,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_access_review" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_access_review_quarter" UNIQUE ("year", "quarter"),
        CONSTRAINT "CHK_access_review_quarter" CHECK ("quarter" BETWEEN 1 AND 4),
        CONSTRAINT "CHK_access_review_status" CHECK ("status" IN ('OPEN', 'CLOSED')),
        CONSTRAINT "CHK_access_review_closed" CHECK (("status" = 'OPEN') = ("closed_at" IS NULL))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "access_review_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "review_id" uuid NOT NULL,
        "account_id" uuid NOT NULL,
        "username" character varying(64) NOT NULL,
        "person_id" uuid,
        "person_name" character varying(150),
        "unit_name" character varying(255),
        "position_title" character varying(160),
        "role" character varying(32) NOT NULL,
        "role_assignment_id" uuid NOT NULL,
        "role_valid_from" TIMESTAMP WITH TIME ZONE NOT NULL,
        "role_valid_to" TIMESTAMP WITH TIME ZONE,
        "reviewer_kind" character varying(12) NOT NULL,
        "reviewer_person_id" uuid,
        "reviewer_name" character varying(150),
        "decision" character varying(8),
        "decided_by" uuid,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "note" text,
        "revoke_applied" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_access_review_item" PRIMARY KEY ("id"),
        CONSTRAINT "FK_access_review_item_review" FOREIGN KEY ("review_id") REFERENCES "access_review"("id"),
        CONSTRAINT "UQ_access_review_item_role" UNIQUE ("review_id", "role_assignment_id"),
        CONSTRAINT "CHK_access_review_item_kind" CHECK ("reviewer_kind" IN ('LEADER', 'DATA_ADMIN')),
        CONSTRAINT "CHK_access_review_item_leader" CHECK (("reviewer_kind" = 'LEADER') = ("reviewer_person_id" IS NOT NULL)),
        CONSTRAINT "CHK_access_review_item_decision" CHECK ("decision" IS NULL OR "decision" IN ('KEEP', 'REVOKE')),
        CONSTRAINT "CHK_access_review_item_decided" CHECK (("decision" IS NULL) = ("decided_at" IS NULL)),
        CONSTRAINT "CHK_access_review_item_revoke" CHECK ("revoke_applied" = false OR "decision" = 'REVOKE')
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_access_review_item_review" ON "access_review_item" ("review_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_access_review_item_reviewer" ON "access_review_item" ("reviewer_person_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "access_review_item"`);
    await queryRunner.query(`DROP TABLE "access_review"`);
  }
}
