import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quản lý tài liệu (ADR-025): danh mục tài liệu, bài đăng (bản tin) và tệp của bài.
 * Tệp của bài không sửa, không xóa (trigger); bài chỉ được gỡ (ẩn), không xóa vật lý.
 */
export class CreateDocuments1761400000000 implements MigrationInterface {
  name = 'CreateDocuments1761400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "document_category" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(120) NOT NULL,
        "description" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_category" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_document_category_name" ON "document_category" (lower("name"))`);

    await queryRunner.query(`
      CREATE TABLE "document_post" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "category_id" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "status" character varying(10) NOT NULL DEFAULT 'PUBLISHED',
        "published_by_account_id" uuid NOT NULL,
        "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_post" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_document_post_status" CHECK ("status" IN ('PUBLISHED', 'WITHDRAWN')),
        CONSTRAINT "CHK_document_post_summary" CHECK (char_length("summary") <= 2000),
        CONSTRAINT "FK_document_post_category" FOREIGN KEY ("category_id") REFERENCES "document_category"("id"),
        CONSTRAINT "FK_document_post_account" FOREIGN KEY ("published_by_account_id") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_document_post_list" ON "document_post" ("status", "published_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_document_post_category" ON "document_post" ("category_id")`);

    await queryRunner.query(`
      CREATE TABLE "document_file" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "post_id" uuid NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "content_type" character varying(120) NOT NULL,
        "size_bytes" integer NOT NULL,
        "storage_key" character varying(255) NOT NULL,
        "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_file" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_document_file_key" UNIQUE ("storage_key"),
        CONSTRAINT "CHK_document_file_size" CHECK ("size_bytes" > 0),
        CONSTRAINT "FK_document_file_post" FOREIGN KEY ("post_id") REFERENCES "document_post"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_document_file_post" ON "document_file" ("post_id")`);

    await queryRunner.query(`
      CREATE FUNCTION document_file_guard() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'Tệp của bài đăng không được sửa hoặc xóa';
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`CREATE TRIGGER document_file_guard BEFORE UPDATE OR DELETE ON "document_file" FOR EACH ROW EXECUTE FUNCTION document_file_guard()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER document_file_guard ON "document_file"`);
    await queryRunner.query(`DROP FUNCTION document_file_guard()`);
    await queryRunner.query(`DROP TABLE "document_file"`);
    await queryRunner.query(`DROP TABLE "document_post"`);
    await queryRunner.query(`DROP TABLE "document_category"`);
  }
}
