import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hồ sơ cán bộ mở rộng (ADR-023): định danh, liên hệ, công tác, trình độ. Mọi cột đều không bắt buộc.
 * Mã cán bộ và số định danh cá nhân (CCCD) không trùng giữa các cán bộ.
 */
export class PersonProfile1761200000000 implements MigrationInterface {
  name = 'PersonProfile1761200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "person"
        ADD COLUMN "employee_code" character varying(32),
        ADD COLUMN "gender" character varying(8),
        ADD COLUMN "ethnicity" character varying(60),
        ADD COLUMN "date_of_birth" date,
        ADD COLUMN "national_id" character varying(12),
        ADD COLUMN "email" character varying(160),
        ADD COLUMN "phone" character varying(20),
        ADD COLUMN "rank" character varying(160),
        ADD COLUMN "salary_grade" character varying(40),
        ADD COLUMN "joined_agency_on" date,
        ADD COLUMN "party_joined_on" date,
        ADD COLUMN "education" character varying(160),
        ADD COLUMN "major" character varying(160),
        ADD COLUMN "political_theory" character varying(16),
        ADD CONSTRAINT "CHK_person_gender" CHECK ("gender" IS NULL OR "gender" IN ('NAM', 'NU', 'KHAC')),
        ADD CONSTRAINT "CHK_person_national_id" CHECK ("national_id" IS NULL OR "national_id" ~ '^[0-9]{12}$'),
        ADD CONSTRAINT "CHK_person_political_theory" CHECK ("political_theory" IS NULL OR "political_theory" IN ('SO_CAP', 'TRUNG_CAP', 'CAO_CAP', 'CU_NHAN'))
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_person_employee_code" ON "person" (upper("employee_code")) WHERE "employee_code" IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_person_national_id" ON "person" ("national_id") WHERE "national_id" IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_person_national_id"`);
    await queryRunner.query(`DROP INDEX "UQ_person_employee_code"`);
    await queryRunner.query(`
      ALTER TABLE "person"
        DROP CONSTRAINT "CHK_person_political_theory", DROP CONSTRAINT "CHK_person_national_id", DROP CONSTRAINT "CHK_person_gender",
        DROP COLUMN "political_theory", DROP COLUMN "major", DROP COLUMN "education", DROP COLUMN "party_joined_on",
        DROP COLUMN "joined_agency_on", DROP COLUMN "salary_grade", DROP COLUMN "rank", DROP COLUMN "phone", DROP COLUMN "email",
        DROP COLUMN "national_id", DROP COLUMN "date_of_birth", DROP COLUMN "ethnicity", DROP COLUMN "gender", DROP COLUMN "employee_code"
    `);
  }
}
