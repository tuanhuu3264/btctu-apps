import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptFile, encryptFile, parseBackupKey } from './crypto.js';

describe('sao lưu: mã hóa tệp', () => {
  let dir: string;
  const key = randomBytes(32);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kpi-bk-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('mã hóa rồi giải mã ra đúng nội dung; tệp mã hóa không chứa nội dung gốc', async () => {
    const plain = Buffer.concat([Buffer.from('Cán bộ: Nguyễn Văn A, điểm 87,6\n'), randomBytes(200_000)]);
    await writeFile(join(dir, 'a.dump'), plain);
    await encryptFile(join(dir, 'a.dump'), join(dir, 'a.enc'), key);
    expect((await readFile(join(dir, 'a.enc'))).includes('điểm 87,6')).toBe(false);
    await decryptFile(join(dir, 'a.enc'), join(dir, 'b.dump'), key);
    expect((await readFile(join(dir, 'b.dump'))).equals(plain)).toBe(true);
  });

  it('sai khóa hoặc tệp bị sửa thì giải mã thất bại', async () => {
    await writeFile(join(dir, 'a.dump'), randomBytes(5000));
    await encryptFile(join(dir, 'a.dump'), join(dir, 'a.enc'), key);
    await expect(decryptFile(join(dir, 'a.enc'), join(dir, 'x'), randomBytes(32))).rejects.toThrow();

    const bytes = await readFile(join(dir, 'a.enc'));
    bytes[bytes.length - 100] ^= 0xff;
    await writeFile(join(dir, 'bad.enc'), bytes);
    await expect(decryptFile(join(dir, 'bad.enc'), join(dir, 'y'), key)).rejects.toThrow();
  });

  it('từ chối tệp không đúng định dạng và khóa sai độ dài', async () => {
    await writeFile(join(dir, 'la'), Buffer.alloc(100, 1));
    await expect(decryptFile(join(dir, 'la'), join(dir, 'z'), key)).rejects.toThrow('Không phải tệp sao lưu');
    expect(() => parseBackupKey('abc')).toThrow('64 ký tự hex');
    expect(parseBackupKey('a'.repeat(64))).toHaveLength(32);
  });
});
