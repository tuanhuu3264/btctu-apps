import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chấm điểm tập thể theo các trục cấu hình được (ADR-036): bảng định nghĩa trục kèm cấu hình mặc định theo bộ tiêu chí,
 * và hai cột lưu ảnh chụp điểm từng trục trên hồ sơ tập thể. Trigger khóa hồ sơ đã phê duyệt (ADR-030) bao cả hai cột mới.
 */
export class UnitEvaluationAxes1761800000000 implements MigrationInterface {
  name = 'UnitEvaluationAxes1761800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "unit_axis" (
        "code" character varying(10) NOT NULL,
        "name" character varying(200) NOT NULL,
        "kind" character varying(8) NOT NULL,
        "max_points" numeric(5,2) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "auto_metric" character varying(24),
        "active" boolean NOT NULL DEFAULT true,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_unit_axis" PRIMARY KEY ("code"),
        CONSTRAINT "CHK_unit_axis_kind" CHECK ("kind" IN ('GENERAL', 'RESULT')),
        CONSTRAINT "CHK_unit_axis_max" CHECK ("max_points" > 0 AND "max_points" <= 70),
        CONSTRAINT "CHK_unit_axis_metric" CHECK ("auto_metric" IS NULL OR "auto_metric" IN ('COMPLETED_SHARE'))
      )
    `);
    await queryRunner.query(`
      INSERT INTO "unit_axis" ("code", "name", "kind", "max_points", "sort_order", "auto_metric") VALUES
      ('G1', 'Chấp hành đường lối, chỉ đạo; xây dựng và thực hiện kế hoạch', 'GENERAL', 10, 10, NULL),
      ('G2', 'Quản lý công chức, môi trường làm việc, đoàn kết, kỷ luật kỷ cương', 'GENERAL', 10, 20, NULL),
      ('G3', 'Cải cách hành chính, chuyển đổi số nội bộ, khắc phục tồn tại hạn chế', 'GENERAL', 10, 30, NULL),
      ('T1', 'Thể chế hóa, tham mưu văn bản', 'RESULT', 15, 110, NULL),
      ('T2', 'Hoàn thành chương trình, kế hoạch năm và nhiệm vụ phát sinh', 'RESULT', 20, 120, 'COMPLETED_SHARE'),
      ('T3', 'Quản lý, điều hành, không sai phạm', 'RESULT', 10, 130, NULL),
      ('T4', 'Phối hợp, điều phối, sáng kiến', 'RESULT', 10, 140, NULL),
      ('T5', 'Chuyển đổi số, đơn giản hóa thủ tục, khoa học công nghệ', 'RESULT', 10, 150, NULL),
      ('T6', 'Giải quyết hồ sơ, đơn thư, kiến nghị', 'RESULT', 5, 160, NULL)
    `);
    await queryRunner.query(`ALTER TABLE "unit_evaluation" ADD COLUMN "self_axis_scores" jsonb`);
    await queryRunner.query(`ALTER TABLE "unit_evaluation" ADD COLUMN "axis_scores" jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "unit_evaluation" DROP COLUMN "axis_scores"`);
    await queryRunner.query(`ALTER TABLE "unit_evaluation" DROP COLUMN "self_axis_scores"`);
    await queryRunner.query(`DROP TABLE "unit_axis"`);
  }
}
