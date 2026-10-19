import { join, resolve } from 'node:path';
import { parseBackupKey } from './crypto.js';
import { DEFAULT_RETENTION } from './retention.js';
import type { RetentionPolicy } from './retention.js';

export interface S3Target {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

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
  s3: S3Target;
  /** Kho MinIO/S3 riêng để lưu bản sao lưu (nơi thứ hai); trống thì không đẩy lên. Phải khác kho tệp đính kèm. */
  remote: S3Target | null;
}

const int = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Giá trị không hợp lệ: ${v} (cần số nguyên không âm)`);
  return n;
};

/**
 * Đích MinIO/S3 của bản sao lưu: BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET (bắt buộc), BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY (bắt buộc),
 * BACKUP_S3_REGION, BACKUP_S3_FORCE_PATH_STYLE. Từ chối khi trùng đúng kho tệp đính kèm, vì dọn bản cũ ở đó sẽ xóa nhầm tệp đính kèm.
 */
export function loadRemote(env: NodeJS.ProcessEnv, app: S3Target): S3Target | null {
  const bucket = env.BACKUP_S3_BUCKET?.trim();
  if (!bucket) return null;
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY?.trim();
  const secretAccessKey = env.BACKUP_S3_SECRET_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) throw new Error('Đặt BACKUP_S3_BUCKET thì cũng cần BACKUP_S3_ACCESS_KEY và BACKUP_S3_SECRET_KEY');
  const remote: S3Target = {
    endpoint: env.BACKUP_S3_ENDPOINT?.trim() || app.endpoint,
    region: env.BACKUP_S3_REGION?.trim() || app.region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: (env.BACKUP_S3_FORCE_PATH_STYLE ?? String(app.forcePathStyle)) === 'true',
  };
  if (remote.endpoint === app.endpoint && remote.bucket === app.bucket) throw new Error('BACKUP_S3_BUCKET trùng kho tệp đính kèm (S3_BUCKET): dùng bucket riêng cho bản sao lưu');
  return remote;
}

/** Đọc cấu hình từ biến môi trường; dùng chung DB_* và S3_* với ứng dụng. */
export function loadBackupConfig(env: NodeJS.ProcessEnv): BackupConfig {
  const s3: S3Target = {
    endpoint: env.S3_ENDPOINT ?? 'http://localhost:9100',
    region: env.S3_REGION ?? 'us-east-1',
    bucket: env.S3_BUCKET ?? 'kpi-files',
    accessKeyId: env.S3_ACCESS_KEY ?? 'kpiminio',
    secretAccessKey: env.S3_SECRET_KEY ?? 'kpiminio-dev-only',
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
  };
  const remote = loadRemote(env, s3);
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
    s3,
    remote,
  };
}
