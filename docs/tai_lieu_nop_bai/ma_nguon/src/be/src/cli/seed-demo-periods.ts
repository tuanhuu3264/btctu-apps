import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { EvaluationService } from '../modules/evaluation/index.js';
import type { Actor } from '../modules/evaluation/index.js';

/**
 * Tạo vài kỳ đánh giá tháng đã phê duyệt để dashboard có số liệu xu hướng khi chạy thử (ADR-027).
 * Chạy đúng luồng của hệ thống (giao chỉ tiêu, tự chấm, thẩm định, phê duyệt) bằng các tài khoản demo của seed-demo,
 * nên điểm, xếp loại và nhật ký đều do chính các quy tắc thật sinh ra. KHÔNG dùng cho môi trường thật.
 * Dùng: npm run seed-demo-periods [-- <năm> <tháng đầu> <tháng cuối>]   (mặc định: 2026 1 4)
 */
const [year = 2026, from = 1, to = 4] = process.argv.slice(2).map(Number);
const DEMO_USERNAMES = ['chuyenvien', 'phophong', 'truongphong', 'photruongban', 'phoban', 'truongban', 'vanphong'];
/** Người được đánh giá; những tài khoản còn lại chỉ đóng vai cấp trên thẩm định, phê duyệt. */
const SUBJECTS = ['chuyenvien', 'phophong', 'truongphong', 'phoban'];

/** Thử lần lượt từng người đến khi có người đủ thẩm quyền làm được; các lỗi khác giữ nguyên để báo. */
async function asFirstAuthorised<T>(actors: Actor[], fn: (a: Actor) => Promise<T>): Promise<{ actor: Actor; result: T }> {
  let last: unknown;
  for (const actor of actors) {
    try {
      return { actor, result: await fn(actor) };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const evaluation = app.get(EvaluationService);
  const db = app.get(DataSource);

  const rows: { id: string; username: string; person_id: string | null }[] = await db.query(
    'select id, username, person_id from account where username = any($1)',
    [DEMO_USERNAMES],
  );
  const actors: Actor[] = DEMO_USERNAMES.flatMap((u) => {
    const r = rows.find((x) => x.username === u);
    return r?.person_id ? [{ id: r.id, username: r.username, personId: r.person_id }] : [];
  });
  if (actors.length < 3) throw new Error('Chưa có tài khoản demo gắn với cán bộ. Hãy chạy npm run seed-demo trước.');
  const creator = actors.find((a) => a.username === 'vanphong') ?? actors[0];

  // Mã công việc có điểm chấm trong danh mục đã duyệt; mỗi người lấy những mã nằm trong phạm vi áp dụng của mình.
  const codes: { code: string }[] = await db.query(
    `select i.code from catalog_item i join catalog_version v on v.id = i.version_id
     where v.status = 'APPROVED' and i.points is not null and i.points > 0 order by i.code`,
  );
  if (codes.length === 0) throw new Error('Chưa có danh mục đã phê duyệt có điểm chấm. Hãy chạy import-catalog và seed-demo --approve-catalog.');

  let seed = 7;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };

  for (let month = from; month <= to; month += 1) {
    const label = `${year}-M${String(month).padStart(2, '0')}`;
    const existing: unknown[] = await db.query('select 1 from evaluation_period where label = $1', [label]);
    if (existing.length > 0) {
      console.log(`${label}: đã có, bỏ qua`);
      continue;
    }
    const period = await evaluation.createPeriod(creator, { type: 'MONTH', year, number: month });
    let approved = 0;

    for (const subject of actors.filter((a) => SUBJECTS.includes(a.username))) {
      try {
        const { actor: reviewer, result: ev } = await asFirstAuthorised(
          actors.filter((a) => a.id !== subject.id),
          (a) => evaluation.createEvaluation(a, period.id, subject.personId!),
        );

        const tasks: string[] = [];
        for (const { code } of codes) {
          if (tasks.length >= 4) break;
          try {
            const t = await evaluation.addTask(reviewer, ev.id, { catalogItemCode: code, plannedQuantity: 2 + rand(5) });
            await evaluation.recordResult(subject, t.id, { completedQuantity: Math.max(0, t.plannedQuantity - rand(2)), evidence: 'Dữ liệu demo' });
            tasks.push(t.id);
          } catch {
            // mã này không thuộc phạm vi áp dụng của cán bộ: thử mã khác
          }
        }
        if (tasks.length === 0) continue;

        await evaluation.selfSubmit(subject, ev.id, { generalScore: 20 + rand(6), comment: 'Dữ liệu demo' });
        const review = {
          generalScore: 18 + rand(8),
          comment: 'Dữ liệu demo',
          tasks: tasks.map((taskId) => ({ taskId, qualityLevel: 1 + rand(3) })),
        };
        try {
          await evaluation.review(reviewer, ev.id, review);
        } catch {
          // cán bộ lãnh đạo, quản lý cần thêm tiêu chí D
          await evaluation.review(reviewer, ev.id, { ...review, leadership: { unitResult: 1, organizing: rand(2) === 0 ? 1 : 0.5, solidarity: 1 } });
        }
        await asFirstAuthorised(actors, (a) => evaluation.approve(a, ev.id, 'Dữ liệu demo'));
        approved += 1;
      } catch (e) {
        console.error(`  ${label} ${subject.username}: bỏ qua (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    await evaluation.closePeriod(period.id);
    console.log(`${label}: đã phê duyệt ${approved} hồ sơ, đã đóng kỳ`);
  }
} catch (e) {
  console.error(`Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
