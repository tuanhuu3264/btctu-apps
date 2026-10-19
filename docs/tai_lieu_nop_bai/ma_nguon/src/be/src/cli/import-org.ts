import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { OrgImportService } from '../modules/organization/application/org-import.service.js';
import { planOrgImport } from '../modules/organization/application/org-import.plan.js';
import { readOrgRowsFromExcel } from '../modules/organization/data-access/excel-org-source.js';

/**
 * Nhập cơ cấu tổ chức từ tệp Excel "Cây sơ đồ phân công nhiệm vụ" (ADR-012 mục 8).
 * Dùng: npm run import-org -- <đường dẫn tệp.xlsx> [--dry-run]
 * --dry-run: chỉ kiểm tra và in kế hoạch, không ghi gì.
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Thiếu đường dẫn tệp Excel. Dùng: npm run import-org -- <tệp.xlsx> [--dry-run]');
  process.exit(1);
}

let rows: string[][];
try {
  rows = await readOrgRowsFromExcel(file);
} catch (e) {
  console.error(`Không đọc được tệp Excel "${file}": ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const plan = planOrgImport(rows);
if (plan.errors.length > 0) {
  console.error(`Tệp có ${plan.errors.length} lỗi, chưa ghi gì:`);
  for (const e of plan.errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`Kế hoạch: ${plan.units.length} đơn vị, ${plan.positions.length} vị trí, ${plan.positions.filter((p) => p.holderName).length} cán bộ giữ vị trí.`);
if (dryRun) {
  console.log('Chế độ --dry-run: không ghi dữ liệu.');
  process.exit(0);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const summary = await app.get(OrgImportService).apply(plan);
  console.log('Đã nhập xong:', JSON.stringify({ ...summary, warnings: summary.warnings.length }));
  for (const w of summary.warnings) console.warn(` ! ${w}`);
} catch (e) {
  console.error(`Không nhập được: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
