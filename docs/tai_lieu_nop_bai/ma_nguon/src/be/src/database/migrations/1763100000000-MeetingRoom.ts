import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Danh mục phòng họp (dữ liệu tham chiếu) và cột phòng trên cuộc họp (ADR-051).
 * Gieo vài phòng mẫu để danh sách chọn không trống; Văn phòng đổi tên, thêm, ngừng sử dụng trên giao diện.
 */
export class MeetingRoom1763100000000 implements MigrationInterface {
  name = 'MeetingRoom1763100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "meeting_room" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(100) NOT NULL,
        "capacity" int,
        "description" varchar(500),
        "status" varchar(8) NOT NULL DEFAULT 'ACTIVE',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_meeting_room_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
        CONSTRAINT "CHK_meeting_room_capacity" CHECK ("capacity" IS NULL OR "capacity" > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_meeting_room_name" ON "meeting_room" (lower("name"))`);
    await queryRunner.query(`
      INSERT INTO "meeting_room" ("name", "capacity", "description") VALUES
        ('Phòng họp số 1', 30, 'Phòng họp mẫu: đổi tên, sức chứa trong màn hình quản lý phòng họp'),
        ('Phòng họp số 2', 15, 'Phòng họp mẫu'),
        ('Phòng họp trực tuyến', NULL, 'Họp qua đường dẫn trực tuyến')
    `);
    await queryRunner.query(`ALTER TABLE "meeting" ADD COLUMN "room_id" uuid REFERENCES "meeting_room"("id")`);
    await queryRunner.query(`CREATE INDEX "IDX_meeting_room" ON "meeting" ("room_id")`);
    // Cuộc họp cũ có địa điểm trùng tên phòng thì gắn luôn vào phòng đó.
    await queryRunner.query(`UPDATE "meeting" m SET "room_id" = r."id" FROM "meeting_room" r WHERE lower(m."location") = lower(r."name")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "meeting" DROP COLUMN "room_id"`);
    await queryRunner.query(`DROP TABLE "meeting_room"`);
  }
}
