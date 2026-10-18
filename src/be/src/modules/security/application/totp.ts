import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Mật khẩu dùng một lần theo thời gian (TOTP, RFC 6238) với HMAC-SHA1, 6 chữ số, bước 30 giây:
 * cấu hình mà các ứng dụng Google Authenticator, Microsoft Authenticator, FreeOTP... đều hỗ trợ.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Chấp nhận mã của bước liền trước và liền sau để bù lệch đồng hồ thiết bị. */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Chuỗi base32 không hợp lệ');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Khóa bí mật 160 bit (độ dài khuyến nghị của RFC 4226), mã hóa base32 để nhập vào ứng dụng. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(ms: number): number {
  return Math.floor(ms / 1000 / TOTP_STEP_SECONDS);
}

/** Mã của một bước thời gian (RFC 4226 mục 5.3, cắt động). */
export function codeAtStep(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Kiểm tra mã. Trả về bước khớp, hoặc null. Bước phải lớn hơn `lastUsedStep` để một mã đã dùng
 * (hoặc bị lộ trong lúc nhập) không dùng lại được trong cửa sổ hiệu lực.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastUsedStep: number | null): number | null {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const current = stepAt(nowMs);
  const given = Buffer.from(normalized);
  let matched: number | null = null;
  // Duyệt hết cửa sổ, không dừng sớm, để thời gian xử lý không lộ bước nào khớp.
  for (let s = current - TOTP_WINDOW; s <= current + TOTP_WINDOW; s++) {
    const same = timingSafeEqual(Buffer.from(codeAtStep(secretBase32, s)), given);
    if (same && s > (lastUsedStep ?? -1) && (matched === null || s > matched)) matched = s;
  }
  return matched;
}

/** Địa chỉ otpauth để tạo mã QR (định dạng Key URI của Google Authenticator). */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
