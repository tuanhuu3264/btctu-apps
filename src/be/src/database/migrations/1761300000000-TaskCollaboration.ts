import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cộng tác trên việc được giao (ADR-024): người duyệt (cc), người tham vấn, trao đổi, tệp đính kèm.
 * Tin nhắn và tệp là nhật ký công việc: không sửa, không xóa (trigger).
 */
export class TaskCollaboration1761300000000 implements MigrationInterface {
  name = 'TaskCollaboration1761300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "approver_person_id" uuid`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "FK_work_assignment_approver" FOREIGN KEY ("approver_person_id") REFERENCES "person"("id")`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_approver" CHECK ("approver_person_id" IS NULL OR "approver_person_id" <> "assignee_person_id")`);

    await queryRunner.query(`
      CREATE TABLE "work_assignment_consultant" (
        "assignment_id" uuid NOT NULL,
        "person_id" uuid NOT NULL,
        "added_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_assignment_consultant" PRIMARY KEY ("assignment_id", "person_id"),
        CONSTRAINT "FK_work_assignment_consultant_assignment" FOREIGN KEY ("assignment_id") REFERENCES "work_assignment"("id"),
        CONSTRAINT "FK_work_assignment_consultant_person" FOREIGN KEY ("person_id") REFERENCES "person"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_work_assignment_consultant_person" ON "work_assignment_consultant" ("person_id")`);

    await queryRunner.query(`
      CREATE TABLE "work_comment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assignment_id" uuid NOT NULL,
        "author_account_id" uuid NOT NULL,
        "author_person_id" uuid,
        "kind" character varying(8) NOT NULL DEFAULT 'MESSAGE',
        "body" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_comment" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_work_comment_kind" CHECK ("kind" IN ('MESSAGE', 'OPINION')),
        CONSTRAINT "CHK_work_comment_body" CHECK (char_length("body") BETWEEN 1 AND 4000),
        CONSTRAINT "FK_work_comment_assignment" FOREIGN KEY ("assignment_id") REFERENCES "work_assignment"("id"),
        CONSTRAINT "FK_work_comment_author" FOREIGN KEY ("author_account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_work_comment_person" FOREIGN KEY ("author_person_id") REFERENCES "person"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_work_comment_assignment" ON "work_comment" ("assignment_id", "created_at")`);

    await queryRunner.query(`
      CREATE TABLE "work_attachment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assignment_id" uuid NOT NULL,
        "comment_id" uuid,
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(120) NOT NULL,
        "size_bytes" integer NOT NULL,
        "storage_key" character varying(255) NOT NULL,
        "uploaded_by_account_id" uuid NOT NULL,
        "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_work_attachment" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_work_attachment_key" UNIQUE ("storage_key"),
        CONSTRAINT "CHK_work_attachment_size" CHECK ("size_bytes" > 0),
        CONSTRAINT "FK_work_attachment_assignment" FOREIGN KEY ("assignment_id") REFERENCES "work_assignment"("id"),
        CONSTRAINT "FK_work_attachment_comment" FOREIGN KEY ("comment_id") REFERENCES "work_comment"("id"),
        CONSTRAINT "FK_work_attachment_uploader" FOREIGN KEY ("uploaded_by_account_id") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_work_attachment_assignment" ON "work_attachment" ("assignment_id")`);

    await queryRunner.query(`
      CREATE FUNCTION work_log_guard() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'Tin nhắn và tệp đính kèm là nhật ký công việc, không được sửa hoặc xóa';
      END;
      $fn$ LANGUAGE plpgsql
    `);
    for (const table of ['work_comment', 'work_attachment']) {
      await queryRunner.query(`CREATE TRIGGER ${table}_guard BEFORE UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION work_log_guard()`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER work_attachment_guard ON "work_attachment"`);
    await queryRunner.query(`DROP TRIGGER work_comment_guard ON "work_comment"`);
    await queryRunner.query(`DROP FUNCTION work_log_guard()`);
    await queryRunner.query(`DROP TABLE "work_attachment"`);
    await queryRunner.query(`DROP TABLE "work_comment"`);
    await queryRunner.query(`DROP TABLE "work_assignment_consultant"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_approver"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "FK_work_assignment_approver"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "approver_person_id"`);
  }
}
