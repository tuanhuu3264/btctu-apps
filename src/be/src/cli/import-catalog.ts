import { basename } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { CatalogImportService } from '../modules/catalog/application/catalog-import.service.js';
import { planCatalogImport } from '../modules/catalog/application/catalog-import.plan.js';
import { readCatalogRowsFromExcel } from '../modules/catalog/data-access/excel-catalog-source.js';

/**
 * Nhập danh mục sản phẩm công việc từ Excel thành một BẢN NHÁP mới (ADR-013 mục 8).
 * Dùng: npm run import-catalog -- <tệp.xlsx> --label "<nhãn phiên bản>" [--name "<tên danh mục>"] [--dry-run]
 * --dry-run: chỉ kiểm tra và in kế hoạch, không ghi gì. Không bao giờ ghi đè phiên bản có sẵn.
 */
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const labelIndex = args.indexOf('--label');
const label = labelIndex >= 0 ? args[labelIndex + 1] : undefined;
const labelValueIndex = labelIndex >= 0 ? labelIndex + 1 : -1;
const nameIndex = args.indexOf('--name');
const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;
const nameValueIndex = nameIndex >= 0 ? nameIndex + 1 : -1;
const file = args.find((a, i) => !a.startsWith('--') && i !== labelValueIndex && i !== nameValueIndex);
if (!file || (!dryRun && !label)) {
  console.error('Dùng: npm run import-catalog -- <tệp.xlsx> --label "<nhãn phiên bản>" [--dry-run]');
  process.exit(1);
}

let rows;
try {
  rows = await readCatalogRowsFromExcel(file);
} catch (e) {
  console.error(`Không đọc được tệp Excel "${file}": ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const plan = planCatalogImport(rows);
if (plan.errors.length > 0) {
  console.error(`Tệp có ${plan.errors.length} lỗi, chưa ghi gì:`);
  for (const e of plan.errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`Kế hoạch: ${plan.groups.length} nhóm, ${plan.items.length} công việc, công việc chuẩn: ${plan.baselineCode ?? 'chưa xác định'}.`);
for (const w of plan.warnings) console.warn(` ! ${w}`);
if (dryRun) {
  console.log('Chế độ --dry-run: không ghi dữ liệu.');
  process.exit(0);
}

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const result = await app.get(CatalogImportService).apply(plan, {
    label: label!,
    name,
    sourceNote: `Nhập từ tệp ${basename(file)}`,
  });
  console.log(`Đã tạo bản nháp "${result.label}" (${result.versionId}) với ${result.itemsCreated} công việc. Cần rà soát rồi trình phê duyệt.`);
} catch (e) {
  console.error(`Không nhập được: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await app.close();
}
