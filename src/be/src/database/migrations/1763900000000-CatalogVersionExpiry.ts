import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thời điểm hết hiệu lực của phiên bản danh mục. Từ thời điểm đó phiên bản không còn là bản đang có hiệu lực nên không giao
 * việc mới từ đó được nữa; việc đã giao và kỳ đã gắn với phiên bản vẫn giữ nguyên. Cột có thể để trống (chưa đặt).
 */
export class CatalogVersionExpiry1763900000000 implements MigrationInterface {
  name = 'CatalogVersionExpiry1763900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "catalog_version" ADD COLUMN "effective_to" timestamptz`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "catalog_version" DROP COLUMN "effective_to"`);
  }
}
