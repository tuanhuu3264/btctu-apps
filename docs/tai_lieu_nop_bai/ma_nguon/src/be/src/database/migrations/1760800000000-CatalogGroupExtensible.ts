import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhóm của danh mục do người dùng thêm được (ADR-020): mã nhóm là một chữ cái A–Z (trước đây chỉ A–D), mã công
 * việc có dạng X.001 với X là mã nhóm. Dữ liệu cũ vẫn hợp lệ.
 */
export class CatalogGroupExtensible1760800000000 implements MigrationInterface {
  name = 'CatalogGroupExtensible1760800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "catalog_group" DROP CONSTRAINT "CHK_catalog_group_code"`);
    await queryRunner.query(`ALTER TABLE "catalog_group" ADD CONSTRAINT "CHK_catalog_group_code" CHECK ("code" ~ '^[A-Z]$')`);
    await queryRunner.query(`ALTER TABLE "catalog_group" ADD CONSTRAINT "CHK_catalog_group_name" CHECK (char_length(btrim("name")) >= 3)`);
    await queryRunner.query(`ALTER TABLE "catalog_item" DROP CONSTRAINT "CHK_catalog_item_code"`);
    await queryRunner.query(`ALTER TABLE "catalog_item" ADD CONSTRAINT "CHK_catalog_item_code" CHECK ("code" ~ '^[A-Z]\\.[0-9]{3}$')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "catalog_item" DROP CONSTRAINT "CHK_catalog_item_code"`);
    await queryRunner.query(`ALTER TABLE "catalog_item" ADD CONSTRAINT "CHK_catalog_item_code" CHECK ("code" ~ '^[A-D]\\.[0-9]{3}$')`);
    await queryRunner.query(`ALTER TABLE "catalog_group" DROP CONSTRAINT "CHK_catalog_group_name"`);
    await queryRunner.query(`ALTER TABLE "catalog_group" DROP CONSTRAINT "CHK_catalog_group_code"`);
    await queryRunner.query(`ALTER TABLE "catalog_group" ADD CONSTRAINT "CHK_catalog_group_code" CHECK ("code" IN ('A', 'B', 'C', 'D'))`);
  }
}
