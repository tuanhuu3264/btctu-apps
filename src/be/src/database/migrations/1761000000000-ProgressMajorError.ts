import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Báo cáo bị từ chối có thể là "sai sót lớn về nội dung" (bị trừ 25% điểm chất lượng) hoặc không (Nghị định 335/2025/NĐ-CP
 * Điều 14.2.b). Cột chỉ có nghĩa với bản ghi bị từ chối. Bản ghi cũ mặc định true để giữ kết quả đã tính; thêm cột có giá trị
 * mặc định không kích hoạt trigger bất biến của work_progress.
 */
export class ProgressMajorError1761000000000 implements MigrationInterface {
  name = 'ProgressMajorError1761000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_progress" ADD COLUMN "major_error" boolean NOT NULL DEFAULT true`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "work_progress" DROP COLUMN "major_error"`);
  }
}
