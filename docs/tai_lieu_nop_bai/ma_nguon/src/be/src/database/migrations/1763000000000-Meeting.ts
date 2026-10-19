import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Lịch họp (ADR-051): cuộc họp, thành phần và trả lời, việc sau họp, biên bản đính kèm. */
export class Meeting1763000000000 implements MigrationInterface {
  name = 'Meeting1763000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "meeting" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" varchar(200) NOT NULL,
        "agenda" text,
        "start_at" timestamptz NOT NULL,
        "end_at" timestamptz NOT NULL,
        "location" varchar(300),
        "online_link" varchar(500),
        "organizer_person_id" uuid NOT NULL REFERENCES "person"("id"),
        "created_by_account_id" uuid NOT NULL REFERENCES "account"("id"),
        "project_id" uuid REFERENCES "project"("id"),
        "status" varchar(10) NOT NULL DEFAULT 'SCHEDULED',
        "cancel_reason" text,
        "conclusion" text,
        "concluded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_meeting_status" CHECK ("status" IN ('SCHEDULED', 'HELD', 'CANCELLED')),
        CONSTRAINT "CHK_meeting_time" CHECK ("end_at" > "start_at" AND "end_at" - "start_at" <= interval '12 hours')
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_meeting_time" ON "meeting" ("start_at", "end_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_meeting_project" ON "meeting" ("project_id")`);

    await queryRunner.query(`
      CREATE TABLE "meeting_attendee" (
        "meeting_id" uuid NOT NULL REFERENCES "meeting"("id"),
        "person_id" uuid NOT NULL REFERENCES "person"("id"),
        "role" varchar(9) NOT NULL,
        "response" varchar(8) NOT NULL DEFAULT 'PENDING',
        "responded_at" timestamptz,
        "note" text,
        "attended" boolean,
        PRIMARY KEY ("meeting_id", "person_id"),
        CONSTRAINT "CHK_meeting_attendee_role" CHECK ("role" IN ('ORGANIZER', 'REQUIRED', 'OPTIONAL')),
        CONSTRAINT "CHK_meeting_attendee_response" CHECK ("response" IN ('PENDING', 'ACCEPTED', 'DECLINED'))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_meeting_attendee_person" ON "meeting_attendee" ("person_id")`);

    await queryRunner.query(`
      CREATE TABLE "meeting_action" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "meeting_id" uuid NOT NULL REFERENCES "meeting"("id"),
        "content" text NOT NULL,
        "assignee_person_id" uuid NOT NULL REFERENCES "person"("id"),
        "due_date" date NOT NULL,
        "status" varchar(7) NOT NULL DEFAULT 'PENDING',
        "completed_on" date,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_meeting_action_status" CHECK ("status" IN ('PENDING', 'DONE')),
        CONSTRAINT "CHK_meeting_action_done" CHECK (("status" = 'DONE') = ("completed_on" IS NOT NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_meeting_action_meeting" ON "meeting_action" ("meeting_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_meeting_action_assignee" ON "meeting_action" ("assignee_person_id")`);

    await queryRunner.query(`
      CREATE TABLE "meeting_attachment" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "meeting_id" uuid NOT NULL REFERENCES "meeting"("id"),
        "file_name" varchar(255) NOT NULL,
        "content_type" varchar(120) NOT NULL,
        "size_bytes" int NOT NULL,
        "storage_key" varchar(300) NOT NULL,
        "uploaded_by_account_id" uuid NOT NULL REFERENCES "account"("id"),
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_meeting_attachment_meeting" ON "meeting_attachment" ("meeting_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "meeting_attachment"`);
    await queryRunner.query(`DROP TABLE "meeting_action"`);
    await queryRunner.query(`DROP TABLE "meeting_attendee"`);
    await queryRunner.query(`DROP TABLE "meeting"`);
  }
}
