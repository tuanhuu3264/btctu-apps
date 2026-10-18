import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { TaskingService } from '../modules/tasking/index.js';

/**
 * Dựng kịch bản trình diễn trên dữ liệu demo: việc quá hạn, sắp đến hạn, chậm tiến độ (để thấy "Cảnh báo sớm" trên Tổng quan),
 * một việc đột xuất đã duyệt và một đề xuất đang chờ duyệt (để thấy "Cần xử lý"). Chạy sau seed-demo (và seed-demo-periods).
 * Chạy đúng luồng của hệ thống bằng các tài khoản demo nên số liệu, nhật ký đều do quy tắc thật sinh ra.
 * Chạy lại thì dời hạn các việc đã có theo ngày hôm nay (không tạo trùng).
 * KHÔNG dùng cho môi trường thật. Dùng: npm run seed-demo-scenarios
 */
if (process.env.NODE_ENV === 'production') {
  console.error('Không chạy seed-demo-scenarios ở môi trường production.');
  process.exit(1);
}

const TASK_TITLE = '[Demo] Kịch bản cảnh báo sớm';
const AD_HOC_APPROVED = '[Demo] Chuẩn bị hồ sơ phục vụ đoàn kiểm tra đột xuất';
const AD_HOC_PENDING = '[Demo] Tổng hợp số liệu gửi Văn phòng Tỉnh ủy trong ngày';

const day = (offset: number): string => new Date(Date.now() + 7 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const tasking = app.get(TaskingService);
  const db = app.get(DataSource);

  const rows: { id: string; username: string; person_id: string | null }[] = await db.query(
    `select id, username, person_id from account where username = any($1)`,
    [['chuyenvien', 'phophong', 'truongphong', 'photruongban', 'phoban', 'truongban']],
  );
  const actors = rows.filter((r) => r.person_id).map((r) => ({ id: r.id, username: r.username, personId: r.person_id }));
  const subject = actors.find((a) => a.username === 'chuyenvien');
  if (!subject) throw new Error('Chưa có tài khoản demo "chuyenvien" gắn với cán bộ. Hãy chạy npm run seed-demo trước.');

  const first = async <T>(fn: (a: (typeof actors)[number]) => Promise<T>): Promise<{ actor: (typeof actors)[number]; value: T }> => {
    let last: unknown;
    for (const actor of actors.filter((a) => a.id !== subject.id)) {
      try {
        return { actor, value: await fn(actor) };
      } catch (e) {
        last = e;
      }
    }
    throw last;
  };

  // Nhiệm vụ riêng của kịch bản. Chạy lại thì dời hạn các việc đã có theo ngày hôm nay (báo cáo đã xác nhận không xóa được
  // vì nhật ký và hồ sơ bất biến), không tạo trùng.
  const existing: { id: string }[] = await db.query(`select id from work_task where assignee_person_id = $1 and title = $2`, [subject.personId, TASK_TITLE]);
  let taskId: string;
  let boss = actors[0];
  if (existing.length > 0) {
    taskId = existing[0].id;
    boss = (await first((a) => tasking.assertAssigner(a, subject.personId!))).actor;
  } else {
    const created = await first((a) => tasking.createTask(a, { assigneePersonId: subject.personId!, title: TASK_TITLE, description: 'Dữ liệu trình diễn cảnh báo sớm' }));
    taskId = created.value.id;
    boss = created.actor;
  }

  const codes: { code: string }[] = await db.query(
    `select i.code from catalog_item i join catalog_version v on v.id = i.version_id
     where v.status = 'APPROVED' and i.points is not null and i.points > 0 order by i.code`,
  );
  const used = new Set<string>();
  const assign = async (planned: number, dueDate: string, note: string, createdDaysAgo = 0) => {
    const found: { id: string }[] = await db.query(`select id from work_assignment where task_id = $1 and note = $2 and status = 'OPEN'`, [taskId, note]);
    if (found.length > 0) {
      await db.query(`update work_assignment set due_date = $2, created_at = $3 where id = $1`, [found[0].id, dueDate, new Date(Date.now() - createdDaysAgo * 86_400_000)]);
      return { assignment: { id: found[0].id }, existing: true };
    }
    for (const { code } of codes) {
      if (used.has(code)) continue;
      try {
        const v = await tasking.assign(boss, { taskId, catalogItemCode: code, plannedQuantity: planned, dueDate, periodMode: 'AUTO', note });
        used.add(code);
        if (createdDaysAgo > 0) await db.query(`update work_assignment set created_at = $2 where id = $1`, [v.assignment.id, new Date(Date.now() - createdDaysAgo * 86_400_000)]);
        return { assignment: { id: v.assignment.id }, existing: false };
      } catch {
        // mã không thuộc phạm vi của cán bộ này hoặc đã giao: thử mã khác
      }
    }
    throw new Error('Không tìm được công việc trong danh mục phù hợp để giao');
  };
  const reportAndConfirm = async (v: { assignment: { id: string }; existing: boolean }, quantity: number, confirm: boolean) => {
    if (v.existing) return;
    const id = v.assignment.id;
    const p = await tasking.report(subject, id, { quantity, completedOn: day(0), evidence: 'Dữ liệu trình diễn' });
    if (confirm) await tasking.decide(boss, p.id, { decision: 'CONFIRM' });
  };

  // 1. Quá hạn 5 ngày, mới xác nhận 1/5 → nguy cơ cao.
  const overdue = await assign(5, day(-5), 'Kịch bản: việc quá hạn');
  await reportAndConfirm(overdue, 1, true);
  // 2. Còn 2 ngày mà chưa làm gì → nguy cơ cao.
  await assign(10, day(2), 'Kịch bản: sắp đến hạn, chưa làm');
  // 3. Còn 3 ngày, đã xác nhận 6/10 → theo dõi.
  const half = await assign(10, day(3), 'Kịch bản: sắp đến hạn, làm được một nửa');
  await reportAndConfirm(half, 6, true);
  // 4. Việc dài: giao cách đây 40 ngày, hạn sau 20 ngày, mới xong 1/10 → chậm so với tiến độ.
  const slow = await assign(10, day(20), 'Kịch bản: chậm so với tiến độ thời gian', 40);
  await reportAndConfirm(slow, 1, true);
  // 5. Việc bình thường, không cảnh báo.
  await assign(4, day(30), 'Kịch bản: việc bình thường');

  // Việc đột xuất: một đã được duyệt (mức khó 3), một đang chờ cấp trên duyệt.
  const adHoc = async (title: string, due: number, approve: boolean) => {
    const found: { id: string }[] = await db.query(`select id from work_assignment where title = $1 and assignee_person_id = $2 and status <> 'CANCELLED'`, [title, subject.personId]);
    if (found.length > 0) {
      await db.query(`update work_assignment set due_date = $2 where id = $1`, [found[0].id, day(due)]);
      return;
    }
    const proposal = await tasking.propose(subject, { title, plannedQuantity: 1, dueDate: day(due), difficulty: 2, note: 'Kịch bản trình diễn' });
    if (approve) await tasking.approveProposal(boss, proposal.assignment.id, { difficulty: 3 });
  };
  await adHoc(AD_HOC_APPROVED, 10, true);
  await adHoc(AD_HOC_PENDING, 1, false);

  const warn = await tasking.earlyWarning(boss, 'team', true).catch(() => null);
  console.log(`Đã dựng kịch bản cho "${subject.username}" (người giao: ${boss.username}).`);
  if (warn) console.log(`Cảnh báo sớm: ${warn.high} nguy cơ cao, ${warn.medium} cần theo dõi.`);
  console.log('Xem: Tổng quan (Cảnh báo sớm, Cần xử lý), Việc được giao, và hồ sơ đánh giá kỳ đang mở (Giải thích điểm và mô phỏng).');
} catch (e) {
  console.error(`Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
