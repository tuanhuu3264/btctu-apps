import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Việc được giao ghi kết quả then chốt (OKR) của người nhận mà việc góp phần đạt (ADR-034).
 * Lưu nguyên nhãn tại lúc giao để về sau cột OKR của vị trí đổi thì việc cũ không đổi theo. Chỉ để theo dõi.
 */
export class AssignmentOkrKeyResult1761700000000 implements MigrationInterface {
  name = 'AssignmentOkrKeyResult1761700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD COLUMN "okr_key_result" text`);
    await queryRunner.query(`ALTER TABLE "work_assignment" ADD CONSTRAINT "CHK_work_assignment_okr" CHECK ("okr_key_result" IS NULL OR char_length("okr_key_result") BETWEEN 1 AND 1000)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP CONSTRAINT "CHK_work_assignment_okr"`);
    await queryRunner.query(`ALTER TABLE "work_assignment" DROP COLUMN "okr_key_result"`);
  }
}
