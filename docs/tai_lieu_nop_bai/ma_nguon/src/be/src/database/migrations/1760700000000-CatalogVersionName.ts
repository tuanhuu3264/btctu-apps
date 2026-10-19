import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tên danh mục của phiên bản, bên cạnh nhãn phiên bản (ADR-013, ADR-019). Phiên bản đã có lấy tên bằng nhãn;
 * trigger khóa phiên bản đã phê duyệt được tắt tạm khi chuyển dữ liệu, không đổi nội dung nào khác.
 */
export class CatalogVersionName1760700000000 implements MigrationInterface {
  name = 'CatalogVersionName1760700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "catalog_version" ADD COLUMN "name" character varying(200)`);
    await queryRunner.query(`ALTER TABLE "catalog_version" DISABLE TRIGGER catalog_version_guard`);
    await queryRunner.query(`UPDATE "catalog_version" SET "name" = "label"`);
    await queryRunner.query(`ALTER TABLE "catalog_version" ENABLE TRIGGER catalog_version_guard`);
    await queryRunner.query(`
      ALTER TABLE "catalog_version"
        ALTER COLUMN "name" SET NOT NULL,
        ADD CONSTRAINT "CHK_catalog_version_name" CHECK (char_length(btrim("name")) >= 3)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "catalog_version" DROP CONSTRAINT "CHK_catalog_version_name", DROP COLUMN "name"`);
  }
}
