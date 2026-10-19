import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUnit1759400000000 implements MigrationInterface {
  name = 'CreateUnit1759400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "unit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(32) NOT NULL,
        "name" character varying(255) NOT NULL,
        "type" character varying(16) NOT NULL,
        "parent_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unit_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_unit_code" UNIQUE ("code"),
        CONSTRAINT "CHK_unit_type" CHECK ("type" IN ('BAN', 'PHONG')),
        CONSTRAINT "FK_unit_parent" FOREIGN KEY ("parent_id") REFERENCES "unit"("id")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "unit"`);
  }
}
