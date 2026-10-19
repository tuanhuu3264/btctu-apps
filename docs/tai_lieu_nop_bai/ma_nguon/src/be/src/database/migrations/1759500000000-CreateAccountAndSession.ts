import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccountAndSession1759500000000 implements MigrationInterface {
  name = 'CreateAccountAndSession1759500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "account" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" character varying(64) NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'ACTIVE',
        "failed_attempts" integer NOT NULL DEFAULT 0,
        "locked_until" TIMESTAMP WITH TIME ZONE,
        "person_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_account_username" UNIQUE ("username"),
        CONSTRAINT "CHK_account_username_lower" CHECK ("username" = lower("username")),
        CONSTRAINT "CHK_account_status" CHECK ("status" IN ('ACTIVE', 'DISABLED'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "session" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "token_hash" character(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_session_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_session_token_hash" UNIQUE ("token_hash"),
        CONSTRAINT "FK_session_account" FOREIGN KEY ("account_id") REFERENCES "account"("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_session_account" ON "session" ("account_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "session"`);
    await queryRunner.query(`DROP TABLE "account"`);
  }
}
