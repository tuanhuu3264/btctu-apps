import { loadBackupConfig } from '../backup/config.js';
import { fileLog, listBackups, restoreBackup, runBackup, verifyBackup } from '../backup/service.js';

/**
 * Sao lưu và phục hồi (ADR-058). Dùng:
 *   npm run backup                              sao lưu CSDL và tệp đính kèm
 *   npm run backup:verify [-- <mốc>]            thử phục hồi bản mới nhất (hoặc bản <mốc>) vào CSDL tạm
 *   npm run backup:list                         liệt kê các bản sao lưu
 *   npm run backup:restore -- <mốc|latest> --into <csdl> [--with-files]   phục hồi vào CSDL trống
 */
try {
  process.loadEnvFile('.env');
} catch {
  // không có tệp .env: dùng biến môi trường đang có
}

const [command = 'run', ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1] === '--into'));

try {
  const config = loadBackupConfig(process.env);
  const log = fileLog(config);
  switch (command) {
    case 'run':
      await runBackup(config, log);
      break;
    case 'verify': {
      const result = await verifyBackup(config, log, positional[0] === 'latest' ? undefined : positional[0]);
      if (!result.ok) process.exitCode = 2;
      break;
    }
    case 'list': {
      const all = await listBackups(config);
      if (all.length === 0) console.log('Chưa có bản sao lưu nào.');
      for (const m of all) {
        const v = m.verified ? `thử phục hồi ${m.verified.ok ? 'đạt' : 'KHÔNG đạt'} lúc ${m.verified.at}` : 'chưa thử phục hồi';
        console.log(`${m.stamp}  ${(m.bytes / 1_048_576).toFixed(1)} MB  ${m.encrypted ? 'mã hóa' : 'không mã hóa'}  ${m.files.objects} tệp đính kèm  ${v}`);
      }
      break;
    }
    case 'restore': {
      const target = flag('--into');
      if (!target) throw new Error('Cần nêu CSDL đích: --into <tên CSDL trống>');
      await restoreBackup(config, log, { stamp: positional[0] === 'latest' ? undefined : positional[0], target, withFiles: rest.includes('--with-files') });
      break;
    }
    default:
      throw new Error(`Lệnh không có: ${command} (run, verify, list, restore)`);
  }
} catch (e) {
  console.error(`Lỗi: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
