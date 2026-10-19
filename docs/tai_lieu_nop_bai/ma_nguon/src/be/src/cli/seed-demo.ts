import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import { CatalogService } from '../modules/catalog/application/catalog.service.js';
import { AccountService, RoleService } from '../modules/security/index.js';
import type { Role } from '../modules/security/index.js';

/**
 * Tạo tài khoản demo cho từng vai trò để thử luồng đầy đủ trên máy phát triển.
 * Chạy sau create-admin, import-org, import-catalog. KHÔNG dùng cho môi trường thật.
 * Mật khẩu sinh ngẫu nhiên và chỉ in ra một lần. Dùng: npm run seed-demo [-- --approve-catalog]
 *
 * Tài khoản gắn với cán bộ theo họ tên trong dữ liệu tổ chức đã nhập (null: không gắn, vai trò quản trị).
 */
const DEMO: { username: string; role: Role; fullName: string | null }[] = [
  { username: 'truongban', role: 'TRUONG_BAN', fullName: 'Nguyễn Thượng Hải' },
  { username: 'phoban', role: 'PHO_TRUONG_BAN', fullName: 'Lưu Vĩnh Hưng' },
  { username: 'truongphong', role: 'TRUONG_PHO_PHONG', fullName: 'Trần Hải Triều' },
  { username: 'chuyenvien', role: 'CHUYEN_VIEN', fullName: 'Hồ Lê Nhân' },
  { username: 'vanphong', role: 'VAN_PHONG', fullName: 'Mai Thị Hoài Thu' },
  { username: 'quantridulieu', role: 'QUAN_TRI_DU_LIEU', fullName: null },
  // Đại diện Ban Thường vụ thẩm định, phê duyệt hồ sơ tập thể của Ban (ADR-030); không gắn cán bộ.
  { username: 'thuongvu', role: 'DAI_DIEN_THUONG_VU', fullName: null },
];

const newPassword = () => `Demo-${randomBytes(9).toString('base64url')}-26`;

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const accounts = app.get(AccountService);
  const roles = app.get(RoleService);
  const db = app.get(DataSource);

  const created: { username: string; password: string; role: Role; person: string }[] = [];
  const skipped: string[] = [];
  for (const d of DEMO) {
    const personRows: { id: string }[] = d.fullName ? await db.query('select id from person where full_name = $1', [d.fullName]) : [];
    if (d.fullName && personRows.length !== 1) {
      console.error(`Bỏ qua ${d.username}: không tìm thấy đúng một cán bộ tên "${d.fullName}" (đã chạy import-org chưa?)`);
      continue;
    }
    const exists: unknown[] = await db.query('select 1 from account where username = $1', [d.username]);
    if (exists.length > 0) {
      skipped.push(d.username);
      continue;
    }
    const password = newPassword();
    const account = await accounts.create({ username: d.username, password });
    await roles.grant(null, { accountId: account.id, role: d.role });
    if (personRows[0]) await accounts.linkPerson(account.id, personRows[0].id);
    created.push({ username: d.username, password, role: d.role, person: d.fullName ?? '(không gắn)' });
  }

  // Chỉ khi có --approve-catalog: duyệt bản nháp mới nhất để tạo được kỳ đánh giá. Bản đã duyệt bị khóa nên không là mặc định.
  const catalog = app.get(CatalogService);
  const versions: { id: string; label: string; status: string }[] = await db.query(
    'select id, label, status from catalog_version order by created_at desc',
  );
  const draft = versions.find((v) => v.status === 'DRAFT');
  if (process.argv.includes('--approve-catalog') && draft && !versions.some((v) => v.status === 'APPROVED')) {
    const approver: { id: string }[] = await db.query('select id from account where username = $1', ['truongban']);
    if (approver[0]) {
      await catalog.approve({ id: approver[0].id }, draft.id);
      console.log(`Đã phê duyệt danh mục "${draft.label}" (người duyệt: truongban)`);
    }
  }

  for (const c of created) console.log(`${c.username.padEnd(14)} ${c.password}  ${c.role}  ${c.person}`);
  if (skipped.length > 0) console.log(`Đã có sẵn, giữ nguyên: ${skipped.join(', ')}`);
} catch (e) {
  console.error(`Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
