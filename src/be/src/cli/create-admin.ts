import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { AccountService, RoleService } from '../modules/security/index.js';

/**
 * Tạo tài khoản đầu tiên. Đọc ADMIN_USERNAME, ADMIN_PASSWORD từ môi trường để mật khẩu không
 * nằm trong lịch sử lệnh. Gán vai trò QUAN_TRI_HE_THONG để có người cấp vai trò cho các tài khoản khác (ADR-011).
 */
const username = process.env.ADMIN_USERNAME;
const password = process.env.ADMIN_PASSWORD;
if (!username || !password) {
  console.error('Thiếu ADMIN_USERNAME hoặc ADMIN_PASSWORD trong môi trường');
  process.exit(1);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const account = await app.get(AccountService).create({ username, password });
  await app.get(RoleService).grant(null, { accountId: account.id, role: 'QUAN_TRI_HE_THONG' });
  console.log(`Đã tạo tài khoản ${account.username} (${account.id}) với vai trò QUAN_TRI_HE_THONG`);
} finally {
  await app.close();
}
