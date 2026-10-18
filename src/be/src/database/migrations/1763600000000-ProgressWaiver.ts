import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Miễn trừ do nguyên nhân khách quan (ADR-056, Nghị định 335/2025/NĐ-CP Điều 14.2.b, c): một lần chậm hoặc một lần chưa đạt được
 * cấp trên xác nhận thì không bị trừ 25%. Lần báo cáo đã xử lý bị trigger khóa nên miễn trừ ở bảng riêng; mỗi lần báo cáo có tối
 * đa một miễn trừ đang hiệu lực. Dòng việc của hồ sơ kỳ ghi thêm số lần được miễn để hồ sơ hiện rõ.
 */
export class ProgressWaiver1763600000000 implements MigrationInterface {
  name = 'ProgressWaiver1763600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "work_progress_waiver" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "progress_id" uuid NOT NULL,
        "kind" varchar(10) NOT NULL,
        "reason" text NOT NULL,
        "granted_by" uuid NOT NULL,
        "granted_at" timestamptz NOT NULL,
        "revoked_by" uuid,
        "revoked_at" timestamptz,
        "revoke_note" text,
        CONSTRAINT "PK_work_progress_waiver" PRIMARY KEY ("id"),
        CONSTRAINT "FK_work_progress_waiver_progress" FOREIGN KEY ("progress_id") REFERENCES "work_progress"("id"),
        CONSTRAINT "FK_work_progress_waiver_granted_by" FOREIGN KEY ("granted_by") REFERENCES "account"("id"),
        CONSTRAINT "FK_work_progress_waiver_revoked_by" FOREIGN KEY ("revoked_by") REFERENCES "account"("id"),
        CONSTRAINT "CHK_work_progress_waiver_kind" CHECK ("kind" IN ('LATE', 'REWORK')),
        CONSTRAINT "CHK_work_progress_waiver_reason" CHECK (length(btrim("reason")) > 0),
        CONSTRAINT "CHK_work_progress_waiver_revoked" CHECK (
          ("revoked_at" IS NULL AND "revoked_by" IS NULL AND "revoke_note" IS NULL)
          OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL AND "revoke_note" IS NOT NULL AND length(btrim("revoke_note")) > 0)
        )
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_work_progress_waiver_active" ON "work_progress_waiver" ("progress_id") WHERE "revoked_at" IS NULL`);
    await queryRunner.query(`
      ALTER TABLE "evaluation_task"
        ADD COLUMN "waived_late_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "waived_rework_count" integer NOT NULL DEFAULT 0,
        ADD CONSTRAINT "CHK_evaluation_task_waived" CHECK ("waived_late_count" >= 0 AND "waived_rework_count" >= 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evaluation_task"
        DROP CONSTRAINT "CHK_evaluation_task_waived",
        DROP COLUMN "waived_rework_count",
        DROP COLUMN "waived_late_count"
    `);
    await queryRunner.query(`DROP TABLE "work_progress_waiver"`);
  }
}
