import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sự kiện ảnh hưởng xếp loại cá nhân (ADR-055): kỷ luật (từ khiển trách trở lên), kết luận suy thoái, trên 50% phiếu tín nhiệm thấp,
 * tham nhũng trong phạm vi quản lý. Kỷ luật bắt buộc có hình thức, hệ thống (đảng, hành chính) và loại vi phạm.
 */
export class RatingEvents1763500000000 implements MigrationInterface {
  name = 'RatingEvents1763500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "rating_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "person_id" uuid NOT NULL,
        "kind" varchar(24) NOT NULL,
        "effective_date" date NOT NULL,
        "decision_no" varchar(100) NOT NULL,
        "form" varchar(20),
        "system" varchar(12),
        "reason" varchar(12),
        "note" text,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rating_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rating_event_person" FOREIGN KEY ("person_id") REFERENCES "person"("id"),
        CONSTRAINT "CHK_rating_event_kind" CHECK ("kind" IN ('KY_LUAT', 'SUY_THOAI', 'TIN_NHIEM_THAP', 'THAM_NHUNG_PHAM_VI')),
        CONSTRAINT "CHK_rating_event_decision" CHECK (length(btrim("decision_no")) > 0),
        CONSTRAINT "CHK_rating_event_discipline" CHECK (
          ("kind" = 'KY_LUAT'
            AND "form" IS NOT NULL AND "system" IS NOT NULL AND "reason" IS NOT NULL
            AND "form" IN ('KHIEN_TRACH', 'CANH_CAO', 'HA_BAC_LUONG', 'GIANG_CHUC', 'CACH_CHUC', 'BUOC_THOI_VIEC', 'KHAI_TRU')
            AND "system" IN ('DANG', 'HANH_CHINH')
            AND "reason" IN ('CONG_VU', 'SUY_THOAI', 'KHAC'))
          OR ("kind" <> 'KY_LUAT' AND "form" IS NULL AND "system" IS NULL AND "reason" IS NULL)
        )
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_rating_event_person_date" ON "rating_event" ("person_id", "effective_date")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "rating_event"`);
  }
}
