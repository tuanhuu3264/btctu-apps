import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hủy kết quả đã phê duyệt để xếp loại lại (ADR-059). Hồ sơ APPROVED vẫn khóa tuyệt đối, trừ đúng một đường: chuyển về PLANNED khi
 * có bản ghi hủy được chèn trong cùng giao dịch (cùng `now()`). Bản ghi hủy lưu nguyên kết quả cũ, chỉ ghi thêm, không sửa, không xóa.
 */
export class EvaluationRevocation1763800000000 implements MigrationInterface {
  name = 'EvaluationRevocation1763800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "evaluation_revocation" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "evaluation_id" uuid NOT NULL,
        "reason_code" varchar(32) NOT NULL,
        "reason" text NOT NULL,
        "revoked_by" uuid NOT NULL,
        "revoked_at" timestamptz NOT NULL DEFAULT now(),
        "previous" jsonb NOT NULL,
        CONSTRAINT "PK_evaluation_revocation" PRIMARY KEY ("id"),
        CONSTRAINT "FK_evaluation_revocation_evaluation" FOREIGN KEY ("evaluation_id") REFERENCES "evaluation"("id"),
        CONSTRAINT "FK_evaluation_revocation_by" FOREIGN KEY ("revoked_by") REFERENCES "account"("id"),
        CONSTRAINT "CHK_evaluation_revocation_code" CHECK ("reason_code" IN ('KHONG_DU_DIEU_KIEN', 'SAI_SO_LIEU', 'KY_LUAT_SAU', 'KHAC')),
        CONSTRAINT "CHK_evaluation_revocation_reason" CHECK (length(btrim("reason")) >= 10)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_evaluation_revocation_evaluation" ON "evaluation_revocation" ("evaluation_id", "revoked_at")`);
    await queryRunner.query(`
      CREATE FUNCTION evaluation_revocation_guard() RETURNS trigger AS $fn$
      BEGIN
        RAISE EXCEPTION 'Bản ghi hủy kết quả chỉ được ghi thêm, không sửa hoặc xóa';
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER evaluation_revocation_guard BEFORE UPDATE OR DELETE ON "evaluation_revocation"
      FOR EACH ROW EXECUTE FUNCTION evaluation_revocation_guard()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION evaluation_guard() RETURNS trigger AS $fn$
      BEGIN
        IF OLD.status = 'APPROVED' THEN
          IF TG_OP = 'UPDATE' AND NEW.status = 'PLANNED' AND EXISTS (
            SELECT 1 FROM evaluation_revocation r WHERE r.evaluation_id = OLD.id AND r.revoked_at = now()
          ) THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'Hồ sơ đánh giá đã phê duyệt, không được sửa hoặc xóa';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION evaluation_guard() RETURNS trigger AS $fn$
      BEGIN
        IF OLD.status = 'APPROVED' THEN
          RAISE EXCEPTION 'Hồ sơ đánh giá đã phê duyệt, không được sửa hoặc xóa';
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP TRIGGER evaluation_revocation_guard ON "evaluation_revocation"`);
    await queryRunner.query(`DROP FUNCTION evaluation_revocation_guard()`);
    await queryRunner.query(`DROP TABLE "evaluation_revocation"`);
  }
}
