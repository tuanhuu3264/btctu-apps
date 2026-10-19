import type { MigrationInterface, QueryRunner } from 'typeorm';

type Set = { sections: { code: string; name: string }[]; items: { code: string; section: string; name: string; max: number }[] };

/** 05-HD/TU Phụ lục 03, Mẫu 5, phần A: tiêu chí chung (30 điểm) đối với cán bộ lãnh đạo, quản lý. */
export const LEADER: Set = {
  sections: [
    { code: '1', name: 'Về phẩm chất chính trị, đạo đức, lối sống, thực hiện trách nhiệm nêu gương' },
    { code: '2', name: 'Tư duy đổi mới, chiến lược, khát vọng cống hiến, dám nghĩ, dám làm' },
    { code: '3', name: 'Về tự phê bình và phê bình, tự soi, tự sửa, khắc phục hạn chế, khuyết điểm' },
  ],
  items: [
    { code: '1.1', section: '1', name: 'Tuyệt đối trung thành với Đảng, Tổ quốc và Nhân dân; kiên định chủ nghĩa Mác - Lênin, tư tưởng Hồ Chí Minh, mục tiêu độc lập dân tộc và chủ nghĩa xã hội; lập trường, quan điểm, bản lĩnh chính trị vững vàng; kiên quyết bảo vệ nền tảng tư tưởng, Cương lĩnh, đường lối của Đảng, Hiến pháp, pháp luật; đấu tranh phản bác các quan điểm sai trái, thù địch, biểu hiện suy thoái, "tự diễn biến", "tự chuyển hóa"', max: 2 },
    { code: '1.2', section: '1', name: 'Yêu nước sâu sắc, tận tụy phục vụ Nhân dân, sâu sát cơ sở, luôn hành động vì lợi ích của Nhân dân; đặt lợi ích của Đảng, quốc gia - dân tộc, Nhân dân, tập thể lên trên lợi ích cá nhân', max: 2 },
    { code: '1.3', section: '1', name: 'Chấp hành nghiêm chủ trương, đường lối, nghị quyết, chỉ thị, quy định, nguyên tắc tổ chức, kỷ luật của Đảng, nhất là nguyên tắc tập trung dân chủ, tự phê bình và phê bình; chấp hành nghiêm pháp luật và quy định của cơ quan, đơn vị; tuyệt đối chấp hành sự phân công của tổ chức', max: 2 },
    { code: '1.4', section: '1', name: 'Tự giác, trách nhiệm cao trong nghiên cứu, học tập chủ nghĩa Mác - Lênin, tư tưởng Hồ Chí Minh, nghị quyết, chỉ thị của Đảng và các chương trình bồi dưỡng, cập nhật kiến thức mới', max: 2 },
    { code: '1.5', section: '1', name: 'Phẩm chất đạo đức, lối sống trong sáng, trung thực, khiêm tốn, cần, kiệm, liêm, chính, chí công vô tư; chấp hành chuẩn mực đạo đức cách mạng, trách nhiệm nêu gương; không vi phạm những điều đảng viên không được làm; không né tránh công việc, chạy theo thành tích; không vi phạm đạo đức, lối sống đến mức bị xử lý kỷ luật', max: 2 },
    { code: '1.6', section: '1', name: 'Không tham vọng quyền lực, chạy chức, chạy quyền; không tham nhũng, lãng phí, cơ hội, vụ lợi, cục bộ, lợi ích nhóm; không để gia đình, người thân lợi dụng chức vụ để trục lợi; không có biểu hiện suy thoái, "tự diễn biến", "tự chuyển hóa"; kiên quyết đấu tranh chống quan liêu, tham nhũng, lãng phí, tiêu cực', max: 2 },
    { code: '1.7', section: '1', name: 'Có uy tín cao, tiêu biểu về phẩm chất đạo đức và phong cách công tác; là trung tâm đoàn kết, thương yêu đồng chí, đồng nghiệp', max: 2 },
    { code: '1.8', section: '1', name: 'Có tinh thần chủ động, đổi mới sáng tạo; phấn đấu vì mục tiêu phát triển của cơ quan, đơn vị, đóng góp vào mục tiêu chung', max: 2 },
    { code: '1.9', section: '1', name: 'Thực hiện kê khai và công khai tài sản, thu nhập theo quy định; báo cáo đầy đủ, trung thực, cung cấp thông tin chính xác, khách quan với cấp trên khi được yêu cầu', max: 2 },
    { code: '2.1', section: '2', name: 'Có tư duy đổi mới, tầm nhìn chiến lược, khả năng lãnh đạo, chỉ đạo thích ứng; phương pháp làm việc khoa học, nhạy bén chính trị; có năng lực cụ thể hóa trong lãnh đạo, chỉ đạo cơ quan, đơn vị hoàn thành tốt chức năng, nhiệm vụ', max: 1 },
    { code: '2.2', section: '2', name: 'Bám sát thực tiễn, có nhiều cách làm hay, sáng tạo, đạt hiệu quả cao trong lãnh đạo, chỉ đạo, tổ chức thực hiện nhiệm vụ; xây dựng tổ chức đảng, cơ quan, đơn vị vững mạnh', max: 1 },
    { code: '2.3', section: '2', name: 'Nói đi đôi với làm; dám nghĩ, dám làm, dám chịu trách nhiệm, dám đột phá vì lợi ích chung; phân tích, dự báo tình hình; đề xuất hoặc quyết định giải pháp phù hợp, kịp thời, hiệu quả', max: 1 },
    { code: '2.4', section: '2', name: 'Có khát vọng phấn đấu, cống hiến; quy tụ và phát huy sức mạnh của tập thể, cá nhân trong cơ quan, đơn vị và các cơ quan, đơn vị liên quan', max: 1 },
    { code: '3.1', section: '3', name: 'Chủ động, nghiêm túc tự phê bình và phê bình; có tinh thần cầu thị, tiếp thu phản biện, góp ý', max: 2 },
    { code: '3.2', section: '3', name: 'Có kế hoạch rõ ràng và quyết liệt trong khắc phục hạn chế, khuyết điểm đã được chỉ ra', max: 2 },
    { code: '3.3', section: '3', name: 'Kết quả khắc phục hoàn thành từ 80% nội dung trở lên, có tiến bộ rõ, được tổ chức đánh giá tốt; không để tái diễn tồn tại', max: 2 },
    { code: '3.4', section: '3', name: 'Tự soi, tự sửa trên tinh thần trách nhiệm chính trị cao, không né tránh, không đổ lỗi', max: 2 },
  ],
};

/** Nghị định 335 Phụ lục II, Mẫu số 01, phần I: tiêu chí chung đối với công chức. */
export const STAFF: Set = {
  sections: [
    { code: 'I', name: 'Phẩm chất chính trị, phẩm chất đạo đức, văn hóa thực thi công vụ và ý thức kỷ luật, kỷ cương trong thực thi công vụ' },
    { code: 'II', name: 'Năng lực chuyên môn, nghiệp vụ; khả năng đáp ứng yêu cầu thực thi nhiệm vụ được giao; tinh thần trách nhiệm; thái độ phục vụ và khả năng phối hợp với đồng nghiệp' },
    { code: 'III', name: 'Năng lực đổi mới, sáng tạo, dám nghĩ, dám làm, dám chịu trách nhiệm vì lợi ích chung trong thực thi công vụ' },
  ],
  items: [
    { code: 'I.1', section: 'I', name: 'Phẩm chất chính trị, phẩm chất đạo đức, văn hóa thực thi công vụ (chấp hành đường lối, nguyên tắc tổ chức, kỷ luật của Đảng; bản lĩnh chính trị; học tập lý luận; đạo đức, lối sống, không suy thoái, tham nhũng, vụ lợi; đoàn kết; thái độ, phong cách chuẩn mực; tự phê bình, khắc phục khuyết điểm đã được chỉ ra)', max: 5 },
    { code: 'I.2', section: 'I', name: 'Ý thức kỷ luật, kỷ cương trong thực thi công vụ (chấp hành sự phân công; quy định, quy chế, nội quy; kê khai tài sản, thu nhập; báo cáo trung thực với cấp trên)', max: 5 },
    { code: 'II.1', section: 'II', name: 'Năng lực chuyên môn, nghiệp vụ theo yêu cầu của vị trí việc làm', max: 2.5 },
    { code: 'II.2', section: 'II', name: 'Khả năng đáp ứng yêu cầu thực thi nhiệm vụ được giao thường xuyên, đột xuất', max: 2.5 },
    { code: 'II.3', section: 'II', name: 'Tinh thần trách nhiệm trong thực thi công vụ', max: 2.5 },
    { code: 'II.4', section: 'II', name: 'Thái độ phục vụ người dân, doanh nghiệp và khả năng phối hợp với đồng nghiệp', max: 2.5 },
    { code: 'III.1', section: 'III', name: 'Có sản phẩm, giải pháp đột phá, sáng tạo đem lại giá trị, hiệu quả thiết thực, tác động tích cực đến kết quả thực hiện nhiệm vụ của cơ quan, đơn vị', max: 2.5 },
    { code: 'III.2', section: 'III', name: 'Sẵn sàng tham gia thực hiện nhiệm vụ chính trị đặc biệt quan trọng, nhiệm vụ có tính chất đột xuất, phức tạp hoặc trong điều kiện khó khăn', max: 2.5 },
    { code: 'III.3', section: 'III', name: 'Có tinh thần chịu trách nhiệm trước kết quả công việc; chủ động nhận trách nhiệm khi có sai sót và có biện pháp khắc phục rõ ràng, cụ thể', max: 2.5 },
    { code: 'III.4', section: 'III', name: 'Chủ động đưa ra quyết định trong phạm vi thẩm quyền, không né tránh; có tinh thần tiên phong trong thực hiện những nhiệm vụ mới', max: 2.5 },
  ],
};

const NOTE = 'Lãnh đạo, quản lý: 05-HD/TU Phụ lục 03 (Mẫu 5, phần A). Công chức: Nghị định 335/2025/NĐ-CP Phụ lục II, Mẫu số 01.';

/**
 * Tiêu chí chung 30 điểm của cá nhân chấm theo mục con (ADR-054): bảng phiên bản `general_criteria_version`, hai cột lưu kết quả
 * chấm từng mục của người tự chấm và người thẩm định. Gieo phiên bản theo văn bản, áp dụng từ tháng sau kỳ tháng, quý cuối cùng
 * đã có người tự chấm (không sớm hơn tháng hiện tại), để các hồ sơ đã chấm một ô 0–30 giữ nguyên.
 */
export class GeneralCriteria1763400000000 implements MigrationInterface {
  name = 'GeneralCriteria1763400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "general_criteria_version" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "effective_from" date NOT NULL,
        "leader" jsonb NOT NULL,
        "staff" jsonb NOT NULL,
        "note" text,
        "created_by" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_general_criteria_version" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_general_criteria_version_from" UNIQUE ("effective_from"),
        CONSTRAINT "CHK_general_criteria_version_day" CHECK (EXTRACT(DAY FROM "effective_from") = 1)
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "evaluation"
        ADD COLUMN "self_general" jsonb,
        ADD COLUMN "general" jsonb,
        ADD CONSTRAINT "CHK_evaluation_self_general_marks" CHECK ("self_general" IS NULL OR jsonb_typeof("self_general") = 'object'),
        ADD CONSTRAINT "CHK_evaluation_general_marks" CHECK ("general" IS NULL OR jsonb_typeof("general") = 'object')
    `);
    const [{ from }] = await queryRunner.query(`
      SELECT to_char(GREATEST(
        date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh'),
        COALESCE((
          SELECT date_trunc('month', (max(p."end_date") + 1)::timestamp)
          FROM "evaluation" e JOIN "evaluation_period" p ON p."id" = e."period_id"
          WHERE p."type" <> 'YEAR' AND (e."self_submitted_at" IS NOT NULL OR e."status" <> 'PLANNED')
        ), '-infinity'::timestamp)
      ), 'YYYY-MM-DD') AS "from"
    `);
    await queryRunner.query(`INSERT INTO "general_criteria_version" ("effective_from", "leader", "staff", "note") VALUES ($1, $2, $3, $4)`, [
      from,
      JSON.stringify(LEADER),
      JSON.stringify(STAFF),
      NOTE,
    ]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "evaluation"
        DROP CONSTRAINT "CHK_evaluation_general_marks",
        DROP CONSTRAINT "CHK_evaluation_self_general_marks",
        DROP COLUMN "general",
        DROP COLUMN "self_general"
    `);
    await queryRunner.query(`DROP TABLE "general_criteria_version"`);
  }
}
