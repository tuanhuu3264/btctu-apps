import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GENESIS_HASH } from '../application/audit.model.js';
import type { AuditQuery, AuditRecord, AuditRecordDraft } from '../application/audit.model.js';
import { AuditLogRepository } from '../application/ports.js';

/** Khóa tư vấn cố định để tuần tự hóa việc nối chuỗi băm giữa các tiến trình. */
const AUDIT_CHAIN_LOCK = 7_316_001;

interface Row {
  id: string;
  occurred_at: Date;
  actor_account_id: string | null;
  actor_username: string | null;
  action: string;
  outcome: AuditRecord['outcome'];
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  request_id: string | null;
  ip: string | null;
  prev_hash: string;
  hash: string;
}

/**
 * Dùng SQL thuần thay vì entity: bảng chỉ cho ghi thêm (trigger chặn UPDATE/DELETE/TRUNCATE),
 * nên không cần các thao tác cập nhật của ORM.
 */
@Injectable()
export class PostgresAuditLogRepository extends AuditLogRepository {
  constructor(@InjectDataSource() private readonly db: DataSource) {
    super();
  }

  async append(build: (prevHash: string) => AuditRecordDraft): Promise<AuditRecord> {
    return this.db.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
      const last: Pick<Row, 'hash'>[] = await m.query('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
      const d = build(last[0]?.hash ?? GENESIS_HASH);
      const rows: Row[] = await m.query(
        `INSERT INTO audit_log (occurred_at, actor_account_id, actor_username, action, outcome, target_type,
                                target_id, details, request_id, ip, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
         RETURNING *`,
        [
          d.occurredAt,
          d.actorAccountId,
          d.actorUsername,
          d.action,
          d.outcome,
          d.targetType,
          d.targetId,
          d.details === null ? null : JSON.stringify(d.details),
          d.requestId,
          d.ip,
          d.prevHash,
          d.hash,
        ],
      );
      return toRecord(rows[0]);
    });
  }

  async find(query: AuditQuery): Promise<AuditRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.action) where.push(`action = $${params.push(query.action)}`);
    if (query.actorId) where.push(`actor_account_id = $${params.push(query.actorId)}`);
    if (query.beforeId) where.push(`id < $${params.push(query.beforeId)}`);
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT * FROM audit_log ${clause} ORDER BY id DESC LIMIT $${params.push(query.limit ?? 50)}`;
    const rows: Row[] = await this.db.query(sql, params);
    return rows.map(toRecord);
  }

  async findAfter(afterId: string | null, limit: number): Promise<AuditRecord[]> {
    const rows: Row[] = await this.db.query(`SELECT * FROM audit_log WHERE id > $1 ORDER BY id ASC LIMIT $2`, [
      afterId ?? '0',
      limit,
    ]);
    return rows.map(toRecord);
  }
}

function toRecord(r: Row): AuditRecord {
  return {
    id: String(r.id),
    occurredAt: r.occurred_at,
    actorAccountId: r.actor_account_id,
    actorUsername: r.actor_username,
    action: r.action,
    outcome: r.outcome,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details,
    requestId: r.request_id,
    ip: r.ip,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}
