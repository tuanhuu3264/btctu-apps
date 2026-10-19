import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Mã hóa khóa TOTP khi lưu (AES-256-GCM): lộ cơ sở dữ liệu không đủ để dựng lại mã xác thực.
 * Dạng lưu: v1.<iv>.<tag>.<dữ liệu> (base64url).
 */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Dữ liệu khóa MFA không đúng định dạng');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** Khóa 32 byte từ chuỗi hex 64 ký tự (biến môi trường MFA_ENCRYPTION_KEY). */
export function parseKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('MFA_ENCRYPTION_KEY phải là 64 ký tự hex (32 byte)');
  return Buffer.from(hex, 'hex');
}

/** Mã khôi phục lưu dạng băm SHA-256: mã có entropy cao nên không cần băm chậm. */
export const hashRecoveryCode = (code: string): string =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');

/** 10 mã khôi phục, mỗi mã 10 ký tự hex dạng xxxxx-xxxxx (40 bit). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const h = randomBytes(5).toString('hex');
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
}

export interface ChallengePayload {
  /** Tài khoản đã qua bước mật khẩu. */
  a: string;
  /** VERIFY: nhập mã; ENROLL: đăng ký thiết bị lần đầu. */
  p: 'VERIFY' | 'ENROLL';
  /** Hết hạn (ms). */
  e: number;
}

/** Thẻ thử thách ngắn hạn, ký HMAC: chứng minh "đã qua bước mật khẩu" mà không cần giữ phiên chưa đủ yếu tố. */
export function signChallenge(payload: ChallengePayload, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', key).update(`mfa-challenge.${body}`).digest('base64url');
  return `${body}.${mac}`;
}

export function openChallenge(token: string, key: Buffer, nowMs: number): ChallengePayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', key).update(`mfa-challenge.${body}`).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChallengePayload;
    return payload.e > nowMs && (payload.p === 'VERIFY' || payload.p === 'ENROLL') && typeof payload.a === 'string' ? payload : null;
  } catch {
    return null;
  }
}
