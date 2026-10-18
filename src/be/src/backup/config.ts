import { join, resolve } from 'node:path';
import { parseBackupKey } from './crypto.js';
import { DEFAULT_RETENTION } from './retention.js';
import type { RetentionPolicy } from './retention.js';

export interface BackupConfig {
  /** Thư mục chứa các bản sao lưu: `db/<mốc thời gian>/`, `files/` (bản chép tệp đính kèm), `backup.log`. */
  dir: string;
  /** Nơi thứ hai (ổ mạng, máy khác, ổ ngoài): mỗi bản sao lưu được chép thêm sang đây. Trống thì chỉ lưu một nơi. */
  offsiteDir: string | null;
  retention: RetentionPolicy;
  /** Khóa mã hóa bản sao lưu CSDL; trống thì không mã hóa. */
  key: Buffer | null;
  pg: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    /** Có tên container thì chạy pg_dump, pg_restore, psql bên trong container (docker exec); không thì dùng công cụ trên máy. */
    container: string | null;
    /** Thư mục chứa pg_dump, pg_restore, psql khi chạy trên máy (mặc định lấy từ PATH). */
    binDir: string | null;
  };
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };
}

const int = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Giá trị không hợp lệ: ${v} (cần số nguyên không âm)`);
  return n;
};

/** Đọc cấu hình từ biến môi trường; dùng chung DB_* và S3_* với ứng dụng. */
export function loadBackupConfig(env: NodeJS.ProcessEnv): BackupConfig {
  const keyHex = env.BACKUP_ENCRYPTION_KEY?.trim();
  return {
    dir: resolve(env.BACKUP_DIR?.trim() || join(process.cwd(), 'backups')),
    offsiteDir: env.BACKUP_OFFSITE_DIR?.trim() ? resolve(env.BACKUP_OFFSITE_DIR.trim()) : null,
    retention: {
      daily: int(env.BACKUP_KEEP_DAILY, DEFAULT_RETENTION.daily),
      weekly: int(env.BACKUP_KEEP_WEEKLY, DEFAULT_RETENTION.weekly),
      monthly: int(env.BACKUP_KEEP_MONTHLY, DEFAULT_RETENTION.monthly),
    },
    key: keyHex ? parseBackupKey(keyHex) : null,
    pg: {
      host: env.DB_HOST ?? 'localhost',
      port: int(env.DB_PORT, 5432),
      user: env.DB_USER ?? 'kpi',
      password: env.DB_PASSWORD ?? 'kpi',
      database: env.DB_NAME ?? 'kpi',
      container: env.BACKUP_PG_CONTAINER?.trim() || null,
      binDir: env.BACKUP_PG_BIN_DIR?.trim() || null,
    },
    s3: {
      endpoint: env.S3_ENDPOINT ?? 'http://localhost:9100',
      region: env.S3_REGION ?? 'us-east-1',
      bucket: env.S3_BUCKET ?? 'kpi-files',
      accessKeyId: env.S3_ACCESS_KEY ?? 'kpiminio',
      secretAccessKey: env.S3_SECRET_KEY ?? 'kpiminio-dev-only',
      forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    },
  };
}
