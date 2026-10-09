import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { requestContext } from '../../../common/request-context.js';
import { computeAuditHash, sanitizeDetails } from './audit-hash.js';
import { GENESIS_HASH } from './audit.model.js';
import type { AuditEntryInput, AuditQuery, AuditRecord, AuditVerification } from './audit.model.js';
import { AuditLogRepository } from './ports.js';

const VERIFY_BATCH = 500;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Ghi và đọc nhật ký bất biến (ADR-011 mục 7). Lỗi khi ghi được ném ra cho nơi gọi
 * (đóng khi lỗi): thao tác không để lại dấu vết thì không nên coi là thành công.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly repo: AuditLogRepository,
    private readonly clock: Clock,
  ) {}

  async record(input: AuditEntryInput): Promise<AuditRecord> {
    const ctx = requestContext.get();
    const actor = input.actor === undefined ? (ctx?.actor ?? null) : input.actor;
    const details = input.details ? (sanitizeDetails(input.details) as Record<string, unknown>) : null;
    const occurredAt = this.clock.now();

    return this.repo.append((prevHash) => {
      const draft = {
        occurredAt,
        actorAccountId: actor?.id ?? null,
        actorUsername: actor?.username ?? null,
        action: input.action,
        outcome: input.outcome,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        details: details && Object.keys(details).length > 0 ? details : null,
        requestId: ctx?.requestId ?? null,
        ip: ctx?.ip ?? null,
        prevHash,
      };
      return { ...draft, hash: computeAuditHash(draft) };
    });
  }

  find(query: AuditQuery): Promise<AuditRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.repo.find({ ...query, limit });
  }

  /**
   * Duyệt toàn bộ chuỗi: mỗi bản ghi phải nối đúng vào bản ghi trước và mã băm phải khớp nội dung.
   * Phát hiện sửa nội dung, xóa hoặc chèn ở giữa. Không phát hiện được việc cắt bớt các bản ghi
   * cuối; cần lưu `lastId` và `lastHash` ở nơi khác để đối chiếu (xem GAP G-14).
   */
  async verify(): Promise<AuditVerification> {
    let previousHash = GENESIS_HASH;
    let afterId: string | null = null;
    let lastId: string | null = null;
    let checked = 0;

    for (;;) {
      const batch = await this.repo.findAfter(afterId, VERIFY_BATCH);
      if (batch.length === 0) break;
      for (const rec of batch) {
        if (rec.prevHash !== previousHash) {
          return {
            valid: false,
            checked,
            lastId,
            lastHash: previousHash,
            firstInvalidId: rec.id,
            reason: 'Không nối đúng vào bản ghi trước (có bản ghi bị xóa hoặc chèn)',
          };
        }
        if (computeAuditHash(rec) !== rec.hash) {
          return {
            valid: false,
            checked,
            lastId,
            lastHash: previousHash,
            firstInvalidId: rec.id,
            reason: 'Nội dung không khớp mã băm (bản ghi bị sửa)',
          };
        }
        previousHash = rec.hash;
        lastId = rec.id;
        checked++;
      }
      afterId = batch[batch.length - 1].id;
    }
    return { valid: true, checked, lastId, lastHash: previousHash };
  }
}
