import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { NotificationService, RETENTION_DAYS } from '../modules/notifications/index.js';

/** Xóa thông báo đã đọc quá hạn lưu (ADR-029 mục 8). Dùng: npm run purge-notifications */
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const removed = await app.get(NotificationService).purge();
  console.log(`Đã xóa ${removed} thông báo đã đọc quá ${RETENTION_DAYS} ngày.`);
} catch (e) {
  console.error(`Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
