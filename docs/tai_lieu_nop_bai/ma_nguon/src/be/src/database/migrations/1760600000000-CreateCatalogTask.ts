import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tầng nhiệm vụ trong danh mục: Nhóm → Nhiệm vụ → Công việc (ADR-019). Công việc đã có được gom vào nhiệm vụ
 * "Chưa phân nhiệm vụ" của nhóm trong cùng phiên bản (kể cả phiên bản đã phê duyệt: tạm tắt trigger khóa để
 * chuyển dữ liệu, không đổi nội dung công việc). Khóa ngoại ghép bảo đảm công việc và nhiệm vụ cùng phiên bản,
 * cùng nhóm. Phiên bản đã phê duyệt khóa luôn nhiệm vụ.
 */
export class CreateCatalogTask1760600000000 implements MigrationInterface {
  name = 'CreateCatalogTask1760600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "catalog_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "version_id" uuid NOT NULL,
        "group_code" character(1) NOT NULL,
        "name" text NOT NULL,
        "description" text,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_catalog_task" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_catalog_task_scope" UNIQUE ("id", "version_id", "group_code"),
        CONSTRAINT "CHK_catalog_task_name" CHECK (char_length(btrim("name")) >= 3),
        CONSTRAINT "FK_catalog_task_version" FOREIGN KEY ("version_id") REFERENCES "catalog_version"("id"),
        CONSTRAINT "FK_catalog_task_group" FOREIGN KEY ("group_code") REFERENCES "catalog_group"("code")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_catalog_task_name" ON "catalog_task" ("version_id", "group_code", lower("name"))`);

    await queryRunner.query(`ALTER TABLE "catalog_item" ADD COLUMN "task_id" uuid`);
    await queryRunner.query(`ALTER TABLE "catalog_item" DISABLE TRIGGER catalog_item_guard`);
    await queryRunner.query(`
      INSERT INTO "catalog_task" ("version_id", "group_code", "name", "sort_order")
      SELECT DISTINCT "version_id", "group_code", 'Chưa phân nhiệm vụ', 0 FROM "catalog_item"
    `);
    await queryRunner.query(`
      UPDATE "catalog_item" i SET "task_id" = t."id"
      FROM "catalog_task" t WHERE t."version_id" = i."version_id" AND t."group_code" = i."group_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "catalog_item"
        ALTER COLUMN "task_id" SET NOT NULL,
        ADD CONSTRAINT "FK_catalog_item_task" FOREIGN KEY ("task_id", "version_id", "group_code")
          REFERENCES "catalog_task"("id", "version_id", "group_code")
    `);
    await queryRunner.query(`ALTER TABLE "catalog_item" ENABLE TRIGGER catalog_item_guard`);
    await queryRunner.query(`CREATE INDEX "IDX_catalog_item_task" ON "catalog_item" ("task_id")`);

    await queryRunner.query(`
      CREATE FUNCTION catalog_task_guard() RETURNS trigger AS $fn$
      DECLARE
        v_status text;
      BEGIN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          SELECT status INTO v_status FROM catalog_version WHERE id = OLD.version_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Danh mục đã phê duyệt, không được sửa nhiệm vụ của phiên bản này';
          END IF;
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          SELECT status INTO v_status FROM catalog_version WHERE id = NEW.version_id;
          IF v_status = 'APPROVED' THEN
            RAISE EXCEPTION 'Danh mục đã phê duyệt, không được sửa nhiệm vụ của phiên bản này';
          END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER catalog_task_guard BEFORE INSERT OR UPDATE OR DELETE ON "catalog_task"
      FOR EACH ROW EXECUTE FUNCTION catalog_task_guard()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER catalog_task_guard ON "catalog_task"`);
    await queryRunner.query(`DROP FUNCTION catalog_task_guard()`);
    await queryRunner.query(`DROP INDEX "IDX_catalog_item_task"`);
    await queryRunner.query(`ALTER TABLE "catalog_item" DROP CONSTRAINT "FK_catalog_item_task", DROP COLUMN "task_id"`);
    await queryRunner.query(`DROP TABLE "catalog_task"`);
  }
}
