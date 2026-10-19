import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phiếu đánh giá khóa theo (kỳ, cán bộ, vị trí) và việc được giao ghi vị trí (PLAN-A A2.4, ADR-047).
 * Cán bộ kiêm nhiệm có một phiếu riêng cho mỗi vị trí. Việc giao trước đây được gắn vào vị trí chính của người nhận
 * tại thời điểm giao (nếu không có thì vị trí sớm nhất của người đó); không xác định được thì để trống và được hiểu là vị trí chính.
 */
export class PhieuTheoViTri1762700000000 implements MigrationInterface {
  name = 'PhieuTheoViTri1762700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "evaluation" DROP CONSTRAINT "UQ_evaluation_period_person"`);
    await queryRunner.query(`ALTER TABLE "evaluation" ADD CONSTRAINT "UQ_evaluation_period_person_position" UNIQUE ("period_id", "person_id", "position_id")`);

    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "position_id" uuid`);
    await queryRunner.query(`
      UPDATE "work_assignment" w SET "position_id" = (
        SELECT a."position_id" FROM "assignment" a
        WHERE a."person_id" = w."assignee_person_id" AND a."kind" = 'PRIMARY' AND a."valid_from" <= w."created_at"
        ORDER BY a."valid_from" DESC LIMIT 1
      )
    `);
    await queryRunner.query(`
      UPDATE "work_assignment" w SET "position_id" = (
        SELECT a."position_id" FROM "assignment" a WHERE a."person_id" = w."assignee_person_id" ORDER BY a."valid_from" ASC LIMIT 1
      ) WHERE w."position_id" IS NULL
    `);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "FK_work_assignment_position" FOREIGN KEY ("position_id") REFERENCES "job_position"("id")`);
    await queryRunner.query(`CREATE INDEX "IDX_work_assignment_position" ON "work_assignment" ("position_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_work_assignment_position"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "FK_work_assignment_position"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "position_id"`);
    // Quay lại khóa (kỳ, cán bộ): giữ phiếu cũ nhất, xóa phiếu của vị trí kiêm nhiệm (cùng dòng chỉ tiêu).
    await queryRunner.query(`
      DELETE FROM "evaluation_task" WHERE "evaluation_id" IN (
        SELECT "id" FROM (
          SELECT "id", row_number() OVER (PARTITION BY "period_id", "person_id" ORDER BY "created_at") AS n FROM "evaluation"
        ) x WHERE x.n > 1
      )
    `);
    await queryRunner.query(`
      DELETE FROM "evaluation" WHERE "id" IN (
        SELECT "id" FROM (
          SELECT "id", row_number() OVER (PARTITION BY "period_id", "person_id" ORDER BY "created_at") AS n FROM "evaluation"
        ) x WHERE x.n > 1
      )
    `);
    await queryRunner.query(`ALTER TABLE "evaluation" DROP CONSTRAINT "UQ_evaluation_period_person_position"`);
    await queryRunner.query(`ALTER TABLE "evaluation" ADD CONSTRAINT "UQ_evaluation_period_person" UNIQUE ("period_id", "person_id")`);
  }
}
