import { createHash } from 'node:crypto';
import type { AuditRecordDraft } from './audit.model.js';

/** JSON ổn định: khóa sắp xếp, bỏ undefined, ngày dạng ISO. Cần để băm lại cho ra cùng kết quả. */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

type Hashable = Omit<AuditRecordDraft, 'hash'>;

/** hash = SHA-256(prevHash | JSON ổn định của các trường). Không gồm id (do CSDL cấp). */
export function computeAuditHash(record: Hashable): string {
  const payload = canonicalJson({
    t: record.occurredAt,
    a: record.actorAccountId,
    u: record.actorUsername,
    c: record.action,
    o: record.outcome,
    tt: record.targetType,
    ti: record.targetId,
    d: record.details,
    r: record.requestId,
    ip: record.ip,
  });
  return createHash('sha256').update(`${record.prevHash}|${payload}`).digest('hex');
}

const SECRET_KEY = /pass(word)?|token|secret|hash|cookie|authorization/i;
const MAX_STRING = 500;

/** Che các khóa nhạy cảm và cắt chuỗi dài trước khi ghi nhật ký. Chặn rò rỉ vô ý từ nơi gọi. */
export function sanitizeDetails(value: unknown): unknown {
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeDetails);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, SECRET_KEY.test(k) ? '[REDACTED]' : sanitizeDetails(v)]),
    );
  }
  return value;
}
