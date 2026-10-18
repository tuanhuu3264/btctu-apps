import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, cp, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupConfig } from './config.js';
import { decryptFile, encryptFile } from './crypto.js';
import { checkMirror, copyMirror, mirrorFiles, restoreFiles } from './files.js';
import { invocation, query, runFromFile, runToFile } from './postgres.js';
import { formatStamp, parseStamp, selectKeep } from './retention.js';

/** Các bảng đếm dòng khi sao lưu để đối chiếu khi thử phục hồi: dữ liệu chỉ thêm hoặc hiếm khi xóa. */
const KEY_TABLES = ['person', 'account', 'work_assignment', 'work_progress', 'work_comment', 'work_attachment', 'evaluation', 'evaluation_task', 'rating_event', 'audit_log'] as const;

export interface Manifest {
  stamp: string;
  createdAt: string;
  database: string;
  encrypted: boolean;
  file: string;
  bytes: number;
  sha256: string;
  /** Số dòng các bảng chính ngay trước khi sao lưu. */
  counts: Record<string, number>;
  tableCount: number;
  migrations: number;
  files: { objects: number; bytes: number; copied: number };
  verified?: { at: string; ok: boolean; detail: string };
}

export type Log = (message: string) => void;

/** Ghi nhật ký sao lưu, phục hồi: một dòng mỗi sự kiện, thêm vào cuối `backup.log` (QĐ 342 Điều 21.4). */
export function fileLog(config: BackupConfig): Log {
  return (message) => {
    const line = `${new Date().toISOString()} ${message}`;
    console.log(line);
    void appendFile(join(config.dir, 'backup.log'), `${line}\n`).catch(() => undefined);
  };
}

const sha256 = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });

const dbRoot = (root: string) => join(root, 'db');
const filesRoot = (root: string) => join(root, 'files');

async function lock(config: BackupConfig): Promise<() => Promise<void>> {
  const path = join(config.dir, 'backup.lock');
  try {
    const age = Date.now() - (await stat(path)).mtimeMs;
    if (age > 12 * 3_600_000) await rm(path, { force: true }); // khóa bỏ lại từ lần chạy hỏng
  } catch {
    // chưa có khóa
  }
  try {
    await (await open(path, 'wx')).close();
  } catch {
    throw new Error('Đang có một lần sao lưu hoặc thử phục hồi khác chạy (tệp backup.lock). Nếu chắc chắn không, xóa tệp đó rồi chạy lại.');
  }
  return () => rm(path, { force: true });
}

async function snapshotCounts(config: BackupConfig): Promise<{ counts: Record<string, number>; tableCount: number; migrations: number }> {
  const db = config.pg.database;
  const present = new Set(await query(config.pg, db, `select table_name from information_schema.tables where table_schema = 'public'`));
  const counts: Record<string, number> = {};
  for (const table of KEY_TABLES) {
    if (present.has(table)) counts[table] = Number((await query(config.pg, db, `select count(*) from "${table}"`))[0]);
  }
  const migrations = present.has('migrations') ? Number((await query(config.pg, db, `select count(*) from migrations`))[0]) : 0;
  return { counts, tableCount: present.size, migrations };
}

async function prune(root: string, config: BackupConfig, log: Log): Promise<void> {
  const dir = dbRoot(root);
  const names = await readdir(dir).catch(() => [] as string[]);
  const keep = selectKeep(names, config.retention);
  for (const name of names) {
    if (parseStamp(name) && !keep.has(name)) {
      await rm(join(dir, name), { recursive: true, force: true });
      log(`PRUNE ${join(dir, name)} (quá thời hạn giữ: ${config.retention.daily} ngày, ${config.retention.weekly} tuần, ${config.retention.monthly} tháng)`);
    }
  }
}

/** Sao lưu CSDL (pg_dump), chép tệp đính kèm, mã hóa nếu có khóa, ghi bảng kê, chép sang nơi thứ hai, dọn bản quá hạn. */
export async function runBackup(config: BackupConfig, log: Log, now = new Date()): Promise<Manifest> {
  await mkdir(config.dir, { recursive: true });
  const release = await lock(config);
  const stamp = formatStamp(now);
  const dir = join(dbRoot(config.dir), stamp);
  try {
    log(`START sao lưu ${stamp} (CSDL ${config.pg.database}${config.key ? ', mã hóa' : ', KHÔNG mã hóa'})`);
    await mkdir(dir, { recursive: true });
    const before = await snapshotCounts(config);

    const plain = join(dir, 'db.dump');
    await runToFile(invocation(config.pg, 'pg_dump', ['-d', config.pg.database, '-Fc']), plain);
    // Bản chép đọc lại được hay không: pg_restore --list đọc toàn bộ mục lục.
    await runFromFile(invocation(config.pg, 'pg_restore', ['--list'], { stdin: true }), plain);

    let file = 'db.dump';
    if (config.key) {
      file = 'db.dump.enc';
      await encryptFile(plain, join(dir, file), config.key);
      await rm(plain, { force: true });
    }
    const final = join(dir, file);
    const files = await mirrorFiles(config.s3, filesRoot(config.dir));
    const manifest: Manifest = {
      stamp,
      createdAt: now.toISOString(),
      database: config.pg.database,
      encrypted: config.key !== null,
      file,
      bytes: (await stat(final)).size,
      sha256: await sha256(final),
      ...before,
      files,
    };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    log(`OK sao lưu ${stamp}: ${file} ${manifest.bytes} byte, ${manifest.tableCount} bảng, ${files.objects} tệp đính kèm (${files.copied} tệp mới)`);

    if (config.offsiteDir) {
      await mkdir(dbRoot(config.offsiteDir), { recursive: true });
      await cp(dir, join(dbRoot(config.offsiteDir), stamp), { recursive: true });
      const copied = await copyMirror(filesRoot(config.dir), filesRoot(config.offsiteDir));
      log(`OK chép sang nơi thứ hai ${config.offsiteDir}: ${copied} tệp đính kèm mới`);
      await prune(config.offsiteDir, config, log);
    }
    await prune(config.dir, config, log);
    return manifest;
  } catch (e) {
    await rm(dir, { recursive: true, force: true }); // không để lại bản dở dang trông như bản dùng được
    log(`FAILED sao lưu ${stamp}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await release();
  }
}

export async function listBackups(config: BackupConfig): Promise<Manifest[]> {
  const names = (await readdir(dbRoot(config.dir)).catch(() => [] as string[])).filter((n) => parseStamp(n)).sort().reverse();
  const out: Manifest[] = [];
  for (const name of names) {
    try {
      out.push(JSON.parse(await readFile(join(dbRoot(config.dir), name, 'manifest.json'), 'utf8')) as Manifest);
    } catch {
      // thư mục thiếu bảng kê: không liệt kê như một bản dùng được
    }
  }
  return out;
}

async function pickBackup(config: BackupConfig, stamp?: string): Promise<Manifest> {
  const all = await listBackups(config);
  const found = stamp ? all.find((m) => m.stamp === stamp) : all[0];
  if (!found) throw new Error(stamp ? `Không có bản sao lưu ${stamp}` : 'Chưa có bản sao lưu nào');
  return found;
}

/** Giải mã (nếu cần) ra tệp tạm và trả đường dẫn tệp dump; `cleanup` xóa tệp tạm. */
async function plainDump(config: BackupConfig, m: Manifest): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = join(dbRoot(config.dir), m.stamp);
  if (!m.encrypted) return { path: join(dir, m.file), cleanup: async () => undefined };
  if (!config.key) throw new Error('Bản sao lưu được mã hóa, cần BACKUP_ENCRYPTION_KEY để giải mã');
  const path = join(dir, '.giai-ma.tmp.dump');
  await decryptFile(join(dir, m.file), path, config.key);
  return { path, cleanup: () => rm(path, { force: true }) };
}

async function checkDigest(config: BackupConfig, m: Manifest): Promise<void> {
  const actual = await sha256(join(dbRoot(config.dir), m.stamp, m.file));
  if (actual !== m.sha256) throw new Error(`Mã băm SHA-256 của ${m.file} không khớp bảng kê: tệp đã bị sửa hoặc hỏng`);
}

export interface VerifyResult {
  stamp: string;
  ok: boolean;
  detail: string;
}

/**
 * Thử phục hồi: kiểm mã băm, phục hồi bản sao lưu vào CSDL tạm `<tên>_restore_test`, đối chiếu số bảng, số migration và số dòng
 * các bảng chính với bảng kê, kiểm toàn vẹn bản chép tệp đính kèm, rồi xóa CSDL tạm. Không đụng đến CSDL đang chạy.
 */
export async function verifyBackup(config: BackupConfig, log: Log, stamp?: string): Promise<VerifyResult> {
  await mkdir(config.dir, { recursive: true });
  const release = await lock(config);
  const temp = `${config.pg.database}_restore_test`;
  let manifest: Manifest | undefined;
  try {
    manifest = await pickBackup(config, stamp);
    log(`START thử phục hồi ${manifest.stamp} vào CSDL tạm ${temp}`);
    await checkDigest(config, manifest);
    const dump = await plainDump(config, manifest);
    try {
      await query(config.pg, 'postgres', `drop database if exists "${temp}"`);
      await query(config.pg, 'postgres', `create database "${temp}"`);
      await runFromFile(invocation(config.pg, 'pg_restore', ['--no-owner', '--exit-on-error', '-d', temp], { stdin: true }), dump.path);

      const present = new Set(await query(config.pg, temp, `select table_name from information_schema.tables where table_schema = 'public'`));
      const problems: string[] = [];
      if (present.size !== manifest.tableCount) problems.push(`số bảng ${present.size}, bảng kê ${manifest.tableCount}`);
      const migrations = Number((await query(config.pg, temp, `select count(*) from migrations`))[0]);
      if (migrations !== manifest.migrations) problems.push(`số migration ${migrations}, bảng kê ${manifest.migrations}`);
      for (const [table, expected] of Object.entries(manifest.counts)) {
        const actual = Number((await query(config.pg, temp, `select count(*) from "${table}"`))[0]);
        if (actual < expected) problems.push(`bảng ${table} có ${actual} dòng, ít hơn ${expected} lúc sao lưu`);
      }
      const mirror = await checkMirror(filesRoot(config.dir));
      if (mirror.problems.length > 0) problems.push(`${mirror.problems.length} tệp đính kèm thiếu hoặc lệch cỡ trong bản chép (ví dụ ${mirror.problems[0]})`);

      const detail = problems.length === 0 ? `phục hồi được, ${present.size} bảng, ${migrations} migration, ${mirror.objects} tệp đính kèm hợp lệ` : problems.join('; ');
      const result: VerifyResult = { stamp: manifest.stamp, ok: problems.length === 0, detail };
      manifest.verified = { at: new Date().toISOString(), ok: result.ok, detail };
      await writeFile(join(dbRoot(config.dir), manifest.stamp, 'manifest.json'), JSON.stringify(manifest, null, 2));
      log(`${result.ok ? 'OK' : 'FAILED'} thử phục hồi ${manifest.stamp}: ${detail}`);
      return result;
    } finally {
      await query(config.pg, 'postgres', `drop database if exists "${temp}"`).catch(() => undefined);
      await dump.cleanup();
    }
  } catch (e) {
    log(`FAILED thử phục hồi ${manifest?.stamp ?? stamp ?? ''}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await release();
  }
}

/**
 * Phục hồi một bản sao lưu vào CSDL `target`. Chỉ vào CSDL chưa có bảng nào, để không ghi đè dữ liệu đang có nhầm; sự cố thật thì
 * tạo CSDL trống (hoặc xóa CSDL hỏng) rồi chạy. Tùy chọn đưa lại tệp đính kèm vào kho.
 */
export async function restoreBackup(config: BackupConfig, log: Log, options: { stamp?: string; target: string; withFiles: boolean }): Promise<void> {
  await mkdir(config.dir, { recursive: true });
  const release = await lock(config);
  let manifest: Manifest | undefined;
  try {
    manifest = await pickBackup(config, options.stamp);
    log(`START phục hồi ${manifest.stamp} vào CSDL ${options.target}`);
    await checkDigest(config, manifest);
    const exists = (await query(config.pg, 'postgres', `select 1 from pg_database where datname = '${options.target.replace(/'/g, "''")}'`)).length > 0;
    if (exists) {
      const tables = Number((await query(config.pg, options.target, `select count(*) from information_schema.tables where table_schema = 'public'`))[0]);
      if (tables > 0) throw new Error(`CSDL ${options.target} đã có ${tables} bảng. Tạo CSDL trống hoặc xóa CSDL hỏng trước, hệ thống không ghi đè.`);
    } else {
      await query(config.pg, 'postgres', `create database "${options.target}"`);
    }
    const dump = await plainDump(config, manifest);
    try {
      await runFromFile(invocation(config.pg, 'pg_restore', ['--no-owner', '--exit-on-error', '-d', options.target], { stdin: true }), dump.path);
    } finally {
      await dump.cleanup();
    }
    log(`OK phục hồi CSDL ${options.target} từ ${manifest.stamp}`);
    if (options.withFiles) {
      const r = await restoreFiles(config.s3, filesRoot(config.dir));
      log(`OK đưa lại tệp đính kèm vào kho: ${r.uploaded} tệp (kho đã có ${r.present})`);
    }
  } catch (e) {
    log(`FAILED phục hồi ${manifest?.stamp ?? options.stamp ?? ''}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    await release();
  }
}
