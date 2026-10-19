import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountRole1759600000000 implements MigrationInterface {
  name = 'CreateAccountRole1759600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "account_role" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "role" character varying(32) NOT NULL,
        "valid_from" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "valid_to" TIMESTAMP WITH TIME ZONE,
        "granted_by" uuid,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_role_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_account_role_role" CHECK ("role" IN (
          'TRUONG_BAN', 'PHO_TRUONG_BAN', 'TRUONG_PHO_PHONG', 'CHUYEN_VIEN',
          'VAN_PHONG', 'QUAN_TRI_HE_THONG', 'QUAN_TRI_DU_LIEU'
        )),
        CONSTRAINT "CHK_account_role_period" CHECK ("valid_to" IS NULL OR "valid_to" > "valid_from"),
        CONSTRAINT "FK_account_role_account" FOREIGN KEY ("account_id") REFERENCES "account"("id"),
        CONSTRAINT "FK_account_role_granted_by" FOREIGN KEY ("granted_by") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_account_role_account" ON "account_role" ("account_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_role"`);
  }
}
