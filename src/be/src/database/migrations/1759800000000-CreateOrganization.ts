import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Cán bộ, vị trí việc làm, phân công và liên kết tài khoản với cán bộ (ADR-012). */
export class CreateOrganization1759800000000 implements MigrationInterface {
  name = 'CreateOrganization1759800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "person" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "full_name" character varying(150) NOT NULL,
        "note" text,
        "active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_person_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_person_full_name" ON "person" ("full_name")`);

    await queryRunner.query(`
      CREATE TABLE "job_position" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(80) NOT NULL,
        "unit_id" uuid NOT NULL,
        "title" character varying(160) NOT NULL,
        "level" smallint NOT NULL,
        "reports_to_position_id" uuid,
        "duties" text,
        "reference_okr" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_position_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_job_position_code" UNIQUE ("code"),
        CONSTRAINT "CHK_job_position_level" CHECK ("level" BETWEEN 1 AND 5),
        CONSTRAINT "CHK_job_position_reports_to" CHECK (
          ("level" = 1 AND "reports_to_position_id" IS NULL) OR ("level" > 1 AND "reports_to_position_id" IS NOT NULL)
        ),
        CONSTRAINT "CHK_job_position_not_self" CHECK ("reports_to_position_id" IS DISTINCT FROM "id"),
        CONSTRAINT "FK_job_position_unit" FOREIGN KEY ("unit_id") REFERENCES "unit"("id"),
        CONSTRAINT "FK_job_position_reports_to" FOREIGN KEY ("reports_to_position_id") REFERENCES "job_position"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_job_position_unit" ON "job_position" ("unit_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_job_position_reports_to" ON "job_position" ("reports_to_position_id")`);

    await queryRunner.query(`
      CREATE TABLE "assignment" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "person_id" uuid NOT NULL,
        "position_id" uuid NOT NULL,
        "valid_from" TIMESTAMP WITH TIME ZONE NOT NULL,
        "valid_to" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_assignment_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_assignment_period" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
        CONSTRAINT "FK_assignment_person" FOREIGN KEY ("person_id") REFERENCES "person"("id"),
        CONSTRAINT "FK_assignment_position" FOREIGN KEY ("position_id") REFERENCES "job_position"("id")
      )
    `);
    // Lớp bảo vệ cuối cho bất biến "một người một vị trí, một vị trí một người" với phân công đang mở.
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_assignment_person_open" ON "assignment" ("person_id") WHERE "valid_to" IS NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_assignment_position_open" ON "assignment" ("position_id") WHERE "valid_to" IS NULL`);

    await queryRunner.query(`ALTER TABLE "account" ADD CONSTRAINT "FK_account_person" FOREIGN KEY ("person_id") REFERENCES "person"("id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_account_person" ON "account" ("person_id") WHERE "person_id" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_account_person"`);
    await queryRunner.query(`ALTER TABLE "account" DROP CONSTRAINT "FK_account_person"`);
    await queryRunner.query(`DROP TABLE "assignment"`);
    await queryRunner.query(`DROP TABLE "job_position"`);
    await queryRunner.query(`DROP TABLE "person"`);
  }
}
