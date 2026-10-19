import type { MigrationInterface, QueryRunner } from 'typeorm';

type Row = [code: string, name: string, kind: 'GENERAL' | 'RESULT', max: number, sort: number, metric: string | null];

/** Sáu tiêu chí chung của tập thể theo Quy định 366-QĐ/TW Phụ lục 1, mỗi tiêu chí 5 điểm (đề xuất, bộ tiêu chí mục 3.2). */
const GENERAL: Row[] = [
  ['C1', 'Xây dựng, chỉnh đốn Đảng; chất lượng cán bộ, đảng viên', 'GENERAL', 5, 10, null],
  ['C2', 'Phối hợp công tác; đoàn kết nội bộ', 'GENERAL', 5, 20, null],
  ['C3', 'Kiểm tra, giám sát, kỷ luật; không để tham nhũng, tiêu cực, suy thoái', 'GENERAL', 5, 30, null],
  ['C4', 'Tập trung dân chủ; chấp hành quy chế làm việc; phân công nhiệm vụ', 'GENERAL', 5, 40, null],
  ['C5', 'Cải cách hành chính, chuyển đổi số, văn hóa công vụ', 'GENERAL', 5, 50, null],
  ['C6', 'Tự phê bình, khắc phục hạn chế, khuyết điểm', 'GENERAL', 5, 60, null],
];
const COMMON: Row[] = [
  ['KH', 'Hoàn thành chương trình, kế hoạch công tác năm và nhiệm vụ phát sinh', 'RESULT', 15, 200, 'COMPLETED_SHARE'],
  ['CS', 'Ứng dụng công nghệ thông tin, chuyển đổi số; thống kê, chế độ báo cáo', 'RESULT', 5, 210, null],
  ['DN', 'Kết quả đánh giá, xếp loại đội ngũ thuộc đơn vị', 'RESULT', 10, 220, null],
];
const DEFAULT_SET: Row[] = [
  ...GENERAL,
  ['BAN1', 'Tham mưu chủ trương, nghị quyết, quy định, đề án của cấp ủy về tổ chức xây dựng Đảng, tổ chức cán bộ, bảo vệ chính trị nội bộ', 'RESULT', 20, 110, null],
  ['BAN2', 'Hướng dẫn, kiểm tra, giám sát, thẩm định trong Đảng bộ tỉnh thuộc lĩnh vực của Ban', 'RESULT', 10, 120, null],
  ['BAN3', 'Điều hành nội bộ, phối hợp hoạt động các phòng; bảo vệ, chăm sóc sức khỏe cán bộ', 'RESULT', 10, 130, null],
  ...COMMON,
];
/** Bộ trục đề xuất theo mã phòng khi nhập cơ cấu (bộ tiêu chí Phụ lục A, Quy định 01-QĐ/BTCTU). */
const PRESETS: Record<string, Row[]> = {
  TCCB: [
    ...GENERAL,
    ['TC1', 'Tham mưu chủ trương, đề án về tổ chức bộ máy, biên chế, cán bộ', 'RESULT', 15, 110, null],
    ['TC2', 'Thẩm định nhân sự và quản lý cán bộ diện Tỉnh ủy, Ban Thường vụ quản lý', 'RESULT', 15, 120, null],
    ['TC3', 'Chính sách cán bộ, đào tạo bồi dưỡng, tiền lương', 'RESULT', 10, 130, null],
    ...COMMON,
  ],
  TCDDV: [
    ...GENERAL,
    ['DD1', 'Xây dựng tổ chức đảng; hướng dẫn, kiểm tra nghiệp vụ; thẩm định đánh giá, xếp loại tổ chức đảng', 'RESULT', 15, 110, null],
    ['DD2', 'Phát triển, quản lý đảng viên và cơ sở dữ liệu đảng viên', 'RESULT', 15, 120, null],
    ['DD3', 'Khen thưởng tổ chức đảng, đảng viên; thi đua của Ngành', 'RESULT', 10, 130, null],
    ...COMMON,
  ],
  BVCTNB: [
    ...GENERAL,
    ['BV1', 'Thẩm tra, xác minh cán bộ, đảng viên có vấn đề về chính trị', 'RESULT', 20, 110, null],
    ['BV2', 'Tiếp nhận, phân loại, tham mưu xử lý đơn thư khiếu nại, tố cáo gửi Ban', 'RESULT', 10, 120, null],
    ['BV3', 'Tham mưu chủ trương, kiểm tra, giám sát công tác bảo vệ chính trị nội bộ; quản lý hồ sơ', 'RESULT', 10, 130, null],
    ...COMMON,
  ],
  VP: [
    ...GENERAL,
    ['VP1', 'Tổng hợp, điều phối chương trình công tác và chế độ thông tin, báo cáo của Ban', 'RESULT', 15, 110, null],
    ['VP2', 'Văn thư, lưu trữ, hành chính, quản trị, tài chính, hậu cần', 'RESULT', 15, 120, null],
    ['VP3', 'Bảo vệ, chăm sóc sức khỏe và chính sách cán bộ; tổ chức cán bộ, thi đua, cải cách hành chính của cơ quan', 'RESULT', 10, 130, null],
    ...COMMON,
  ],
};

/**
 * Bộ trục chấm điểm tập thể theo từng đơn vị (ADR-052). Bảng `unit_axis` thêm `unit_id`: null là bộ mặc định (hồ sơ của Ban
 * và phòng chưa có bộ riêng), mã trục duy nhất trong mỗi bộ. Khung chuyển từ Nghị định 335 Điều 6, 7 (cơ quan hành chính nhà
 * nước) sang Quy định 366-QĐ/TW Phụ lục 1 (khối cơ quan tham mưu của Đảng).
 *
 * Gieo dữ liệu: bộ riêng cho các phòng có mã TCCB, TCDDV, BVCTNB, VP; thay bộ mặc định. Bộ nào đang có hồ sơ chờ thẩm định
 * hoặc phê duyệt trong kỳ năm đang mở thì giữ nguyên, để cùng một kỳ chấm theo cùng bộ trục (ADR-036 mục 6).
 */
export class UnitAxisPerUnit1763200000000 implements MigrationInterface {
  name = 'UnitAxisPerUnit1763200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "unit_axis" ADD COLUMN "id" uuid NOT NULL DEFAULT gen_random_uuid()`);
    await queryRunner.query(`ALTER TABLE "unit_axis" ADD COLUMN "unit_id" uuid REFERENCES "unit"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "unit_axis" DROP CONSTRAINT "PK_unit_axis"`);
    await queryRunner.query(`ALTER TABLE "unit_axis" ADD CONSTRAINT "PK_unit_axis" PRIMARY KEY ("id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_unit_axis_set_code" ON "unit_axis" (COALESCE("unit_id", '00000000-0000-0000-0000-000000000000'::uuid), "code")`);
    await queryRunner.query(`CREATE INDEX "IDX_unit_axis_unit" ON "unit_axis" ("unit_id")`);

    const inFlight = async (unitIds: string[]): Promise<boolean> => {
      if (unitIds.length === 0) return false;
      const rows: { n: string }[] = await queryRunner.query(
        `SELECT count(*) AS n FROM "unit_evaluation" e JOIN "evaluation_period" p ON p."id" = e."period_id"
          WHERE p."type" = 'YEAR' AND p."status" = 'OPEN' AND e."status" IN ('SELF_SUBMITTED', 'REVIEWED') AND e."unit_id" = ANY($1)`,
        [unitIds],
      );
      return Number(rows[0].n) > 0;
    };
    const insert = async (unitId: string | null, rows: Row[]) => {
      for (const [code, name, kind, max, sort, metric] of rows) {
        await queryRunner.query(
          `INSERT INTO "unit_axis" ("unit_id", "code", "name", "kind", "max_points", "sort_order", "auto_metric") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [unitId, code, name, kind, max, sort, metric],
        );
      }
    };

    const units: { id: string; code: string; type: string }[] = await queryRunner.query(`SELECT "id", "code", "type" FROM "unit"`);
    const seeded = new Set<string>();
    for (const u of units) {
      const preset = PRESETS[u.code];
      if (!preset || u.type !== 'PHONG' || (await inFlight([u.id]))) continue;
      await insert(u.id, preset);
      seeded.add(u.id);
    }
    const onDefault = units.filter((u) => !seeded.has(u.id)).map((u) => u.id);
    if (!(await inFlight(onDefault))) {
      await queryRunner.query(`DELETE FROM "unit_axis" WHERE "unit_id" IS NULL`);
      await insert(null, DEFAULT_SET);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "unit_axis" WHERE "unit_id" IS NOT NULL`);
    await queryRunner.query(`DROP INDEX "IDX_unit_axis_unit"`);
    await queryRunner.query(`DROP INDEX "UQ_unit_axis_set_code"`);
    await queryRunner.query(`ALTER TABLE "unit_axis" DROP CONSTRAINT "PK_unit_axis"`);
    await queryRunner.query(`ALTER TABLE "unit_axis" DROP COLUMN "unit_id"`);
    await queryRunner.query(`ALTER TABLE "unit_axis" DROP COLUMN "id"`);
    await queryRunner.query(`ALTER TABLE "unit_axis" ADD CONSTRAINT "PK_unit_axis" PRIMARY KEY ("code")`);
  }
}
