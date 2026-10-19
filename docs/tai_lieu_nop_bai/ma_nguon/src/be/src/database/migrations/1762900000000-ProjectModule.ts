import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Đề án, dự án (ADR-050): hồ sơ, thành viên, mốc tiến độ, tài liệu đính kèm, và mã đề án trên việc được giao.
 * Điểm KPI không đổi: đề án chỉ nhóm và theo dõi việc.
 */
export class ProjectModule1762900000000 implements MigrationInterface {
  name = 'ProjectModule1762900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "project" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "code" varchar(20) NOT NULL,
        "kind" varchar(6) NOT NULL,
        "title" varchar(200) NOT NULL,
        "objective" text,
        "description" text,
        "owner_person_id" uuid NOT NULL REFERENCES "person"("id"),
        "unit_id" uuid REFERENCES "unit"("id"),
        "start_date" date NOT NULL,
        "end_date" date NOT NULL,
        "status" varchar(10) NOT NULL DEFAULT 'DRAFT',
        "created_by_account_id" uuid NOT NULL REFERENCES "account"("id"),
        "submitted_at" timestamptz,
        "approved_by_account_id" uuid REFERENCES "account"("id"),
        "approved_at" timestamptz,
        "return_reason" text,
        "completed_on" date,
        "close_note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_project_code" UNIQUE ("code"),
        CONSTRAINT "CHK_project_kind" CHECK ("kind" IN ('DE_AN', 'DU_AN')),
        CONSTRAINT "CHK_project_status" CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
        CONSTRAINT "CHK_project_dates" CHECK ("end_date" >= "start_date")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_project_owner" ON "project" ("owner_person_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_project_status" ON "project" ("status")`);

    await queryRunner.query(`
      CREATE TABLE "project_member" (
        "project_id" uuid NOT NULL REFERENCES "project"("id"),
        "person_id" uuid NOT NULL REFERENCES "person"("id"),
        "role" varchar(6) NOT NULL,
        PRIMARY KEY ("project_id", "person_id"),
        CONSTRAINT "CHK_project_member_role" CHECK ("role" IN ('LEAD', 'MEMBER'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_project_member_person" ON "project_member" ("person_id")`);

    await queryRunner.query(`
      CREATE TABLE "project_milestone" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL REFERENCES "project"("id"),
        "title" varchar(200) NOT NULL,
        "due_date" date NOT NULL,
        "weight" int NOT NULL DEFAULT 1,
        "assignee_person_id" uuid REFERENCES "person"("id"),
        "status" varchar(7) NOT NULL DEFAULT 'PENDING',
        "completed_on" date,
        "note" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_project_milestone_status" CHECK ("status" IN ('PENDING', 'DONE')),
        CONSTRAINT "CHK_project_milestone_weight" CHECK ("weight" BETWEEN 1 AND 100),
        CONSTRAINT "CHK_project_milestone_done" CHECK (("status" = 'DONE') = ("completed_on" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_project_milestone_project" ON "project_milestone" ("project_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_project_milestone_assignee" ON "project_milestone" ("assignee_person_id")`);

    await queryRunner.query(`
      CREATE TABLE "project_attachment" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "project_id" uuid NOT NULL REFERENCES "project"("id"),
        "file_name" varchar(255) NOT NULL,
        "content_type" varchar(120) NOT NULL,
        "size_bytes" int NOT NULL,
        "storage_key" varchar(300) NOT NULL,
        "uploaded_by_account_id" uuid NOT NULL REFERENCES "account"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_project_attachment_project" ON "project_attachment" ("project_id")`);

    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "project_id" uuid REFERENCES "project"("id")`);
    await queryRunner.query(`CREATE INDEX "IDX_work_assignment_project" ON "work_assignment" ("project_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "project_id"`);
    await queryRunner.query(`DROP TABLE "project_attachment"`);
    await queryRunner.query(`DROP TABLE "project_milestone"`);
    await queryRunner.query(`DROP TABLE "project_member"`);
    await queryRunner.query(`DROP TABLE "project"`);
  }
}
