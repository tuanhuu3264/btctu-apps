import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tự đóng phiên khi không thao tác (ADR-057, Sổ tay Bộ Nội vụ 2026 Chương VIII): phiên ghi lần thao tác cuối. Phiên đang có lấy
 * thời điểm tạo làm lần thao tác cuối, nên phiên cũ không thao tác sẽ đóng ở lần dùng kế tiếp.
 */
export class SessionIdle1763700000000 implements MigrationInterface {
  name = 'SessionIdle1763700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session" ADD COLUMN "last_active_at" timestamptz NOT NULL DEFAULT now()`);
    await queryRunner.query(`UPDATE "session" SET "last_active_at" = "created_at"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "last_active_at"`);
  }
}
