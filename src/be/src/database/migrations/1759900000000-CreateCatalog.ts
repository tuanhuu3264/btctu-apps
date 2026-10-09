import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Danh mục sản phẩm công việc chuẩn (ADR-013). Trigger khóa phiên bản đã phê duyệt: không thêm, sửa,
 * xóa công việc của phiên bản đó, không sửa hay xóa chính phiên bản.
 */
export class CreateCatalog1759900000000 implements MigrationInterface {
  name = 'CreateCatalog1759900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog_group" (
        "code" character(1) NOT NULL,
        "name" character varying(255) NOT NULL,
        "sort_order" integer NOT NULL,
        CONSTRAINT "PK_catalog_group" PRIMARY KEY ("code"),
        CONSTRAINT "CHK_catalog_group_code" CHECK ("code" IN ('A', 'B', 'C', 'D'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO "catalog_group" ("code", "name", "sort_order") VALUES
        ('A', 'NHÓM CÔNG VIỆC THEO VTVL LÃNH ĐẠO, QUẢN LÝ CẤP PHÒNG', 1),
        ('B', 'NHÓM CÔNG VIỆC THEO VTVL CHUYÊN MÔN DÙNG CHUNG (GỒM: VĂN THƯ; HÀNH CHÍNH; TÀI CHÍNH NỘI BỘ)', 2),
        ('C', 'NHÓM CÔNG VIỆC THEO VTVL CHUYÊN MÔN, NGHIỆP VỤ', 3),
        ('D', 'NHÓM CÔNG VIỆC KHÁC', 4)
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog_version" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "label" character varying(120) NOT NULL,
        "status" character varying(10) NOT NULL DEFAULT 'DRAFT',
        "baseline_item_code" character varying(10),
        "effective_from" TIMESTAMP WITH TIME ZONE,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "approved_by" uuid,
        "source_note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_version" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_version_label" UNIQUE ("label"),
        CONSTRAINT "CHK_catalog_version_status" CHECK ("status" IN ('DRAFT', 'APPROVED')),
        CONSTRAINT "CHK_catalog_version_approved" CHECK (
          "status" = 'DRAFT' OR (
            "approved_at" IS NOT NULL AND "approved_by" IS NOT NULL AND
            "effective_from" IS NOT NULL AND "baseline_item_code" IS NOT NULL
          )
        ),
        CONSTRAINT "FK_catalog_version_approved_by" FOREIGN KEY ("approved_by") REFERENCES "account"("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "catalog_item" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "version_id" uuid NOT NULL,
        "code" character varying(10) NOT NULL,
        "group_code" character(1) NOT NULL,
        "name" text NOT NULL,
        "product_units" text,
        "complexity" smallint NOT NULL,
        "duration_mode" character varying(12) NOT NULL,
        "duration_value" numeric(10,3),
        "duration_unit" character varying(4),
        "points" numeric(10,2),
        "explanation" text,
        "sort_order" integer NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_item" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_item_code" UNIQUE ("version_id", "code"),
        CONSTRAINT "CHK_catalog_item_code" CHECK ("code" ~ '^[A-D]\\.[0-9]{3}$'),
        CONSTRAINT "CHK_catalog_item_group" CHECK ("group_code" = left("code", 1)),
        CONSTRAINT "CHK_catalog_item_complexity" CHECK ("complexity" BETWEEN 1 AND 4),
        CONSTRAINT "CHK_catalog_item_points" CHECK ("points" IS NULL OR "points" >= 0),
        CONSTRAINT "CHK_catalog_item_duration_mode" CHECK ("duration_mode" IN ('LIMITED', 'ACTUAL', 'UNSPECIFIED')),
        CONSTRAINT "CHK_catalog_item_duration_unit" CHECK ("duration_unit" IS NULL OR "duration_unit" IN ('HOUR', 'DAY')),
        CONSTRAINT "CHK_catalog_item_duration" CHECK (
          ("duration_mode" = 'LIMITED' AND "duration_value" > 0 AND "duration_unit" IS NOT NULL) OR
          ("duration_mode" <> 'LIMITED' AND "duration_value" IS NULL AND "duration_unit" IS NULL)
        ),
        CONSTRAINT "FK_catalog_item_version" FOREIGN KEY ("version_id") REFERENCES "catalog_version"("id"),
        CONSTRAINT "FK_catalog_item_group" FOREIGN KEY ("group_code") REFERENCES "catalog_group"("code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_item_version" ON "catalog_item" ("version_id")`);

    await queryRunner.query(`
      CREATE FUNCTION catalog_item_guard() RETURNS trigger AS $fn$
      DECLARE
        v_status text;
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          SELECT status INTO v_status FROM catalog_version WHERE id = OLD.version_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Danh mục đã phê duyệt, không được sửa công việc của phiên bản này';
          END IF;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          SELECT status INTO v_status FROM catalog_version WHERE id = NEW.version_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Danh mục đã phê duyệt, không được sửa công việc của phiên bản này';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER catalog_item_guard BEFORE INSERT OR UPDATE OR DELETE ON "catalog_item"
      FOR EACH ROW EXECUTE FUNCTION catalog_item_guard()
    `);

    await queryRunner.query(`
      CREATE FUNCTION catalog_version_guard() RETURNS trigger AS $fn$
      BEGIN
        IF OLD.status = 'APPROVED' THEN
          RAISE EXCEPTION 'Danh mục đã phê duyệt, không được sửa hoặc xóa phiên bản này';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER catalog_version_guard BEFORE UPDATE OR DELETE ON "catalog_version"
      FOR EACH ROW EXECUTE FUNCTION catalog_version_guard()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER catalog_version_guard ON "catalog_version"`);
    await queryRunner.query(`DROP FUNCTION catalog_version_guard()`);
    await queryRunner.query(`DROP TRIGGER catalog_item_guard ON "catalog_item"`);
    await queryRunner.query(`DROP FUNCTION catalog_item_guard()`);
    await queryRunner.query(`DROP TABLE "catalog_item"`);
    await queryRunner.query(`DROP TABLE "catalog_version"`);
    await queryRunner.query(`DROP TABLE "catalog_group"`);
  }
}
