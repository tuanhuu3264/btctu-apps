import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phạm vi áp dụng của công việc trong danh mục: đơn vị hoặc vị trí việc làm được giao công việc đó (ADR-021).
 * Mỗi dòng là một đơn vị hoặc một vị trí. Phiên bản đã phê duyệt khóa luôn phạm vi.
 */
export class CreateCatalogItemScope1760900000000 implements MigrationInterface {
  name = 'CreateCatalogItemScope1760900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog_item_scope" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "item_id" uuid NOT NULL,
        "unit_id" uuid,
        "position_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_item_scope" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_catalog_item_scope_target" CHECK (("unit_id" IS NULL) <> ("position_id" IS NULL)),
        CONSTRAINT "FK_catalog_item_scope_item" FOREIGN KEY ("item_id") REFERENCES "catalog_item"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_catalog_item_scope_unit" FOREIGN KEY ("unit_id") REFERENCES "unit"("id"),
        CONSTRAINT "FK_catalog_item_scope_position" FOREIGN KEY ("position_id") REFERENCES "job_position"("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_catalog_item_scope_unit" ON "catalog_item_scope" ("item_id", "unit_id") WHERE "unit_id" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_catalog_item_scope_position" ON "catalog_item_scope" ("item_id", "position_id") WHERE "position_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_item_scope_item" ON "catalog_item_scope" ("item_id")`);

    await queryRunner.query(`
      CREATE FUNCTION catalog_item_scope_guard() RETURNS trigger AS $fn$
      DECLARE
        v_status text;
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          SELECT v.status INTO v_status FROM catalog_item i JOIN catalog_version v ON v.id = i.version_id WHERE i.id = OLD.item_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Danh mục đã phê duyệt, không được sửa phạm vi áp dụng của công việc';
          END IF;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          SELECT v.status INTO v_status FROM catalog_item i JOIN catalog_version v ON v.id = i.version_id WHERE i.id = NEW.item_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Danh mục đã phê duyệt, không được sửa phạm vi áp dụng của công việc';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER catalog_item_scope_guard BEFORE INSERT OR UPDATE OR DELETE ON "catalog_item_scope"
      FOR EACH ROW EXECUTE FUNCTION catalog_item_scope_guard()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER catalog_item_scope_guard ON "catalog_item_scope"`);
    await queryRunner.query(`DROP FUNCTION catalog_item_scope_guard()`);
    await queryRunner.query(`DROP TABLE "catalog_item_scope"`);
  }
}
