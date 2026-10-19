import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Thông báo trong hệ thống (ADR-029): gắn với cán bộ nhận, đọc và đánh dấu đã đọc. */
export class CreateNotifications1761500000000 implements MigrationInterface {
  name = 'CreateNotifications1761500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notification" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "recipient_person_id" uuid NOT NULL,
        "type" character varying(30) NOT NULL,
        "title" character varying(200) NOT NULL,
        "link" character varying(200),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "read_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_notification" PRIMARY KEY ("id"),
        CONSTRAINT "FK_notification_person" FOREIGN KEY ("recipient_person_id") REFERENCES "person"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_notification_recipient" ON "notification" ("recipient_person_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_notification_unread" ON "notification" ("recipient_person_id") WHERE "read_at" IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notification"`);
  }
}
