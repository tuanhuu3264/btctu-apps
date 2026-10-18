import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { BackupConfig } from './config.js';

export interface FileEntry {
  size: number;
  contentType: string | null;
}
/** Danh sách tệp đính kèm đã chép: khóa đối tượng -> cỡ, kiểu nội dung. Tệp đính kèm không sửa, không xóa nên so cỡ là đủ. */
export type FileIndex = Record<string, FileEntry>;

export interface FileSummary {
  objects: number;
  bytes: number;
  copied: number;
}

const INDEX_NAME = 'files-index.json';

export const s3Client = (config: BackupConfig['s3']): S3Client =>
  new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

/** Đường dẫn trong thư mục sao lưu của một khóa đối tượng; khóa trỏ ra ngoài thư mục thì bị từ chối. */
export function localPathOf(dir: string, key: string): string {
  const root = resolve(dir);
  const target = resolve(root, ...key.split('/'));
  if (key.startsWith('/') || key.includes('\\') || target !== join(root, ...key.split('/')) || !target.startsWith(root + sep)) {
    throw new Error(`Khóa đối tượng không hợp lệ: ${key}`);
  }
  return target;
}

async function* listBucket(client: S3Client, bucket: string): AsyncGenerator<{ key: string; size: number }> {
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key) yield { key: o.Key, size: o.Size ?? 0 };
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

async function readIndex(dir: string): Promise<FileIndex> {
  try {
    return JSON.parse(await readFile(join(dir, INDEX_NAME), 'utf8')) as FileIndex;
  } catch {
    return {};
  }
}

const sizeOnDisk = async (path: string): Promise<number | null> => {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
};

/** Chép các tệp đính kèm chưa có (hoặc khác cỡ) từ kho sang thư mục `dir`. Lần sau chỉ chép phần mới. Không xóa gì ở thư mục sao lưu. */
export async function mirrorFiles(config: BackupConfig['s3'], dir: string): Promise<FileSummary> {
  const client = s3Client(config);
  await mkdir(dir, { recursive: true });
  const index = await readIndex(dir);
  const summary: FileSummary = { objects: 0, bytes: 0, copied: 0 };
  for await (const { key, size } of listBucket(client, config.bucket)) {
    const path = localPathOf(dir, key);
    summary.objects += 1;
    summary.bytes += size;
    if ((await sizeOnDisk(path)) === size && index[key]) continue;
    const got = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    await mkdir(dirname(path), { recursive: true });
    const partial = `${path}.part`;
    try {
      await pipeline(got.Body as Readable, createWriteStream(partial));
      await rename(partial, path);
    } catch (e) {
      await rm(partial, { force: true });
      throw e;
    }
    index[key] = { size, contentType: got.ContentType ?? null };
    summary.copied += 1;
  }
  await writeFile(join(dir, INDEX_NAME), JSON.stringify(index, null, 1));
  return summary;
}

/** Kiểm tra bản chép tệp đính kèm: mọi tệp trong danh sách có mặt với đúng cỡ. Trả danh sách khóa thiếu hoặc lệch. */
export async function checkMirror(dir: string): Promise<{ objects: number; problems: string[] }> {
  const index = await readIndex(dir);
  const problems: string[] = [];
  for (const [key, entry] of Object.entries(index)) {
    if ((await sizeOnDisk(localPathOf(dir, key))) !== entry.size) problems.push(key);
  }
  return { objects: Object.keys(index).length, problems };
}

/** Chép các tệp của bản chép `src` chưa có (hoặc khác cỡ) sang `dst`, nơi lưu thứ hai. Trả số tệp mới chép. */
export async function copyMirror(src: string, dst: string): Promise<number> {
  const index = await readIndex(src);
  await mkdir(dst, { recursive: true });
  let copied = 0;
  for (const [key, entry] of Object.entries(index)) {
    const target = localPathOf(dst, key);
    if ((await sizeOnDisk(target)) === entry.size) continue;
    await mkdir(dirname(target), { recursive: true });
    await copyFile(localPathOf(src, key), target);
    copied += 1;
  }
  await writeFile(join(dst, INDEX_NAME), JSON.stringify(index, null, 1));
  return copied;
}

/** Đưa lại vào kho những tệp có trong bản chép mà kho chưa có (dùng khi dựng lại kho trống). */
export async function restoreFiles(config: BackupConfig['s3'], dir: string): Promise<{ uploaded: number; present: number }> {
  const client = s3Client(config);
  const index = await readIndex(dir);
  // Kho mới dựng lại có thể chưa có bucket.
  await client.send(new HeadBucketCommand({ Bucket: config.bucket })).catch(() => client.send(new CreateBucketCommand({ Bucket: config.bucket })));
  const existing = new Set<string>();
  for await (const { key } of listBucket(client, config.bucket)) existing.add(key);
  let uploaded = 0;
  for (const [key, entry] of Object.entries(index)) {
    if (existing.has(key)) continue;
    const body = await readFile(localPathOf(dir, key));
    if (body.length !== entry.size) throw new Error(`Tệp sao lưu bị lệch cỡ: ${key}`);
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: entry.contentType ?? undefined }));
    uploaded += 1;
  }
  return { uploaded, present: existing.size };
}
