import { CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { S3Target } from './config.js';
import { localPathOf, s3Client } from './files.js';
import { parseStamp, selectKeep } from './retention.js';
import type { RetentionPolicy } from './retention.js';

/**
 * Nơi lưu thứ hai trên kho S3/MinIO riêng (ADR-058, mục sao lưu lên MinIO). Cùng cách đặt tên với thư mục sao lưu:
 *   db/<mốc>/db.dump(.enc), db/<mốc>/manifest.json, files/<khóa tệp đính kèm>, files/files-index.json
 */
const INDEX_KEY = 'files/files-index.json';

async function* list(config: S3Target, prefix: string): AsyncGenerator<{ key: string; size: number }> {
  const client = s3Client(config);
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key) yield { key: o.Key, size: o.Size ?? 0 };
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export async function ensureBucket(config: S3Target): Promise<void> {
  const client = s3Client(config);
  await client.send(new HeadBucketCommand({ Bucket: config.bucket })).catch(() => client.send(new CreateBucketCommand({ Bucket: config.bucket })));
}

async function put(config: S3Target, key: string, path: string, contentType?: string | null): Promise<void> {
  const { size } = await stat(path);
  await s3Client(config).send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: createReadStream(path), ContentLength: size, ContentType: contentType ?? undefined }));
}

async function download(config: S3Target, key: string, target: string): Promise<void> {
  const got = await s3Client(config).send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  await mkdir(dirname(target), { recursive: true });
  const partial = `${target}.part`;
  try {
    await pipeline(got.Body as Readable, createWriteStream(partial));
    await rename(partial, target);
  } catch (e) {
    await rm(partial, { force: true });
    throw e;
  }
}

const stampOf = (key: string): string | null => {
  const m = /^db\/([^/]+)\//.exec(key);
  return m && parseStamp(m[1]) ? m[1] : null;
};

/** Các mốc sao lưu trên MinIO, mới nhất trước; chỉ tính mốc có đủ bảng kê. */
export async function listRemote(config: S3Target): Promise<{ stamp: string; bytes: number }[]> {
  const found = new Map<string, { bytes: number; manifest: boolean }>();
  for await (const { key, size } of list(config, 'db/')) {
    const stamp = stampOf(key);
    if (!stamp) continue;
    const cur = found.get(stamp) ?? { bytes: 0, manifest: false };
    if (key.endsWith('/manifest.json')) cur.manifest = true;
    else cur.bytes += size;
    found.set(stamp, cur);
  }
  return [...found].filter(([, v]) => v.manifest).map(([stamp, v]) => ({ stamp, bytes: v.bytes })).sort((a, b) => b.stamp.localeCompare(a.stamp));
}

/**
 * Đẩy một bản sao lưu và bản chép tệp đính kèm mới lên MinIO. Bảng kê tải lên sau cùng: có bảng kê nghĩa là bản đã đủ tệp.
 * Tệp đính kèm chỉ tải phần chưa có (so khóa và cỡ).
 */
export async function pushBackup(config: S3Target, localRoot: string, stamp: string): Promise<{ filesUploaded: number }> {
  await ensureBucket(config);
  const dir = join(localRoot, 'db', stamp);
  const names = (await readdir(dir)).filter((n) => n !== 'manifest.json' && !n.startsWith('.'));
  for (const name of names) await put(config, `db/${stamp}/${name}`, join(dir, name));

  const index = JSON.parse(await readFile(join(localRoot, 'files', 'files-index.json'), 'utf8').catch(() => '{}')) as Record<string, { size: number; contentType: string | null }>;
  const have = new Map<string, number>();
  for await (const { key, size } of list(config, 'files/')) have.set(key, size);
  let filesUploaded = 0;
  for (const [key, entry] of Object.entries(index)) {
    if (have.get(`files/${key}`) === entry.size) continue;
    await put(config, `files/${key}`, localPathOf(join(localRoot, 'files'), key), entry.contentType);
    filesUploaded += 1;
  }
  await put(config, INDEX_KEY, join(localRoot, 'files', 'files-index.json'));
  await put(config, `db/${stamp}/manifest.json`, join(dir, 'manifest.json'));
  return { filesUploaded };
}

/** Xóa các mốc quá thời hạn giữ trên MinIO. Chỉ đụng khóa `db/<mốc>/...`; tệp đính kèm không bao giờ bị xóa. */
export async function pruneRemote(config: S3Target, policy: RetentionPolicy): Promise<string[]> {
  const byStamp = new Map<string, string[]>();
  for await (const { key } of list(config, 'db/')) {
    const stamp = stampOf(key);
    if (stamp) byStamp.set(stamp, [...(byStamp.get(stamp) ?? []), key]);
  }
  const keep = selectKeep([...byStamp.keys()], policy);
  const removed: string[] = [];
  const client = s3Client(config);
  for (const [stamp, keys] of byStamp) {
    if (keep.has(stamp)) continue;
    await client.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: keys.map((Key) => ({ Key })) } }));
    removed.push(stamp);
  }
  return removed;
}

/** Tải một mốc (mặc định mới nhất) từ MinIO về thư mục sao lưu để thử phục hồi hoặc phục hồi như bản thường. Tùy chọn tải cả bản chép tệp đính kèm. */
export async function pullBackup(config: S3Target, localRoot: string, options: { stamp?: string; withFiles: boolean }): Promise<{ stamp: string; files: number }> {
  const all = await listRemote(config);
  const stamp = options.stamp ?? all[0]?.stamp;
  if (!stamp || !all.some((m) => m.stamp === stamp)) throw new Error(options.stamp ? `MinIO không có bản sao lưu ${options.stamp}` : 'MinIO chưa có bản sao lưu nào');
  const dir = join(localRoot, 'db', stamp);
  const keys: string[] = [];
  for await (const { key } of list(config, `db/${stamp}/`)) keys.push(key);
  // Bảng kê tải sau cùng để thư mục dở dang không trông như bản dùng được.
  for (const key of keys.filter((k) => !k.endsWith('/manifest.json'))) await download(config, key, join(dir, key.split('/').pop()!));
  await download(config, `db/${stamp}/manifest.json`, join(dir, 'manifest.json'));
  let files = 0;
  if (options.withFiles) {
    for await (const { key, size } of list(config, 'files/')) {
      const target = join(localRoot, 'files', ...key.slice('files/'.length).split('/'));
      if (key === INDEX_KEY || (await stat(target).then((s) => s.size, () => -1)) !== size) {
        await download(config, key, target);
        if (key !== INDEX_KEY) files += 1;
      }
    }
  }
  return { stamp, files };
}
