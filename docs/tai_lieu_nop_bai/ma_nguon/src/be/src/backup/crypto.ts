import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/** Đầu tệp mã hóa: nhận diện định dạng và phiên bản. Sau đó là IV 12 byte, nội dung, rồi thẻ xác thực 16 byte. */
const MAGIC = Buffer.from('KPIBK1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

/** Khóa AES-256 từ 64 ký tự hex (BACKUP_ENCRYPTION_KEY). */
export function parseBackupKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('BACKUP_ENCRYPTION_KEY phải là 64 ký tự hex (32 byte)');
  return Buffer.from(hex, 'hex');
}

/** Mã hóa AES-256-GCM theo luồng, không đọc cả tệp vào bộ nhớ. */
export async function encryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(target);
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(source), cipher, out);
  await appendFile(target, cipher.getAuthTag());
}

/** Giải mã và kiểm tra thẻ xác thực; sai khóa hoặc tệp bị sửa thì ném lỗi (tệp đích không đáng tin). */
export async function decryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const { size } = await stat(source);
  if (size < HEADER_BYTES + TAG_BYTES) throw new Error('Tệp mã hóa quá ngắn hoặc hỏng');
  const handle = await open(source, 'r');
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    await handle.read(header, 0, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Không phải tệp sao lưu mã hóa của hệ thống');
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await pipeline(createReadStream(source, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }), decipher, createWriteStream(target));
  } finally {
    await handle.close();
  }
}
