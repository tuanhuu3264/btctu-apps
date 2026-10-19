import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { BackupConfig } from './config.js';

type Tool = 'pg_dump' | 'pg_restore' | 'psql';

interface Invocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** Dòng lệnh chạy một công cụ PostgreSQL: trong container (docker exec) hoặc trực tiếp trên máy. Mật khẩu truyền qua biến môi trường, không qua tham số. */
export function invocation(config: BackupConfig['pg'], tool: Tool, args: string[], options: { stdin?: boolean } = {}): Invocation {
  if (config.container) {
    return {
      command: 'docker',
      args: ['exec', ...(options.stdin ? ['-i'] : []), '-e', `PGPASSWORD=${config.password}`, config.container, tool, '-U', config.user, ...args],
      env: process.env,
    };
  }
  const command = config.binDir ? join(config.binDir, tool) : tool;
  return { command, args: ['-h', config.host, '-p', String(config.port), '-U', config.user, ...args], env: { ...process.env, PGPASSWORD: config.password } };
}

function describe(inv: Invocation): string {
  // Không in mật khẩu: nó nằm trong env hoặc trong tham số -e PGPASSWORD=...
  return [inv.command, ...inv.args.map((a) => (a.startsWith('PGPASSWORD=') ? 'PGPASSWORD=***' : a))].join(' ');
}

function finish(inv: Invocation, child: ReturnType<typeof spawn>, stderr: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error(`Không chạy được ${inv.command}: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${describe(inv)} thất bại (mã ${code}): ${stderr.join('').trim().slice(-600)}`));
    });
  });
}

/** Chạy lệnh, ghi đầu ra chuẩn vào tệp. */
export async function runToFile(inv: Invocation, target: string): Promise<void> {
  const child = spawn(inv.command, inv.args, { env: inv.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr: string[] = [];
  child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));
  const done = finish(inv, child, stderr);
  await Promise.all([pipeline(child.stdout, createWriteStream(target)), done]);
}

/** Chạy lệnh, lấy nội dung tệp làm đầu vào chuẩn. */
export async function runFromFile(inv: Invocation, source: string): Promise<void> {
  const child = spawn(inv.command, inv.args, { env: inv.env, stdio: ['pipe', 'ignore', 'pipe'] });
  const stderr: string[] = [];
  child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));
  const done = finish(inv, child, stderr);
  // pg_restore có thể dừng đọc sớm khi gặp lỗi; lỗi ghi vào ống đóng thì để `done` báo nguyên nhân thật.
  child.stdin.on('error', () => undefined);
  await Promise.all([pipeline(createReadStream(source), child.stdin).catch(() => undefined), done]);
}

/** Chạy lệnh và trả đầu ra chuẩn. */
export async function runCapture(inv: Invocation): Promise<string> {
  const child = spawn(inv.command, inv.args, { env: inv.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out: string[] = [];
  const stderr: string[] = [];
  child.stdout.on('data', (d: Buffer) => out.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => stderr.push(d.toString()));
  await finish(inv, child, stderr);
  return out.join('');
}

/** Chạy một câu SQL (psql -At) và trả các dòng kết quả. */
export async function query(config: BackupConfig['pg'], database: string, sql: string): Promise<string[]> {
  const out = await runCapture(invocation(config, 'psql', ['-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]));
  return out.split(/\r?\n/).filter((l) => l !== '');
}
