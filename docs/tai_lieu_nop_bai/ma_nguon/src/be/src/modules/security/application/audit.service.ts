import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { buildExportFile, MAX_EXPORT_ROWS } from '../../../common/table-export.js';
import type { ExportedTable, TableFormat } from '../../../common/table-export.js';
import { requestContext } from '../../../common/request-context.js';
import { classifyAction } from './audit-classify.js';
import { AUDIT_HASH_VERSION, computeAuditHash, sanitizeDetails } from './audit-hash.js';
import { GENESIS_HASH } from './audit.model.js';
import type { AuditEntryInput, AuditQuery, AuditRecord, AuditVerification } from './audit.model.js';
import { AuditLogRepository } from './ports.js';

const VERIFY_BATCH = 500;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Giờ Việt Nam (UTC+7) dạng `YYYY-MM-DD HH:mm:ss`, gọn hơn ISO để cột thời điểm không bị bẻ dòng. */
const vnTime = (d: Date): string => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');

const MODULE_TEXT: Record<string, string> = { security: 'Bảo mật', organization: 'Tổ chức', catalog: 'Danh mục', tasking: 'Giao việc', evaluation: 'Đánh giá', reporting: 'Báo cáo', documents: 'Tài liệu', notifications: 'Thông báo', system: 'Hệ thống' };
const TYPE_TEXT: Record<string, string> = { CREATE: 'Tạo mới', UPDATE: 'Sửa', DELETE: 'Xóa', STATUS_CHANGE: 'Đổi trạng thái', APPROVE: 'Luồng duyệt', LOGIN: 'Đăng nhập', EXPORT: 'Xuất tệp', ACCESS: 'Xem, tải', REVIEW: 'Rà soát quyền', OTHER: 'Khác' };

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
    const classified = classifyAction(input.action);

    return this.repo.append((prevHash) => {
      const draft = {
        occurredAt,
        actorAccountId: actor?.id ?? null,
        actorUsername: actor?.username ?? null,
        action: input.action,
        outcome: input.outcome,
        module: input.module ?? classified.module,
        type: input.type ?? classified.type,
        hashVersion: AUDIT_HASH_VERSION,
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

  actions(): Promise<string[]> {
    return this.repo.distinctActions();
  }

  /** Lịch sử của một đối tượng (ví dụ `unit` + id), mới nhất trước. */
  historyOf(targetType: string, targetId: string, query: Pick<AuditQuery, 'beforeId' | 'limit'> = {}): Promise<AuditRecord[]> {
    return this.find({ ...query, targetType, targetId });
  }

  find(query: AuditQuery): Promise<AuditRecord[]> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    return this.repo.find({ ...query, limit });
  }

  /**
   * Xuất nhật ký theo bộ lọc ra Excel hoặc PDF (PLAN-A A6). Không xuất cột chi tiết (có thể chứa dữ liệu trước/sau của hồ sơ);
   * muốn xem chi tiết dùng màn hình nhật ký. Tối đa `MAX_EXPORT_ROWS`, mới nhất trước. Việc xuất cũng được ghi lại.
   */
  async exportTable(query: AuditQuery, format: TableFormat): Promise<ExportedTable> {
    const cap = MAX_EXPORT_ROWS[format];
    const rows: AuditRecord[] = [];
    let beforeId = query.beforeId;
    while (rows.length < cap) {
      const page = await this.repo.find({ ...query, beforeId, limit: Math.min(MAX_LIMIT, cap - rows.length) });
      rows.push(...page);
      if (page.length < MAX_LIMIT) break;
      beforeId = page[page.length - 1].id;
    }
    const truncated = rows.length >= cap;
    const info: [string, string][] = [['Sắp xếp', 'Mới nhất trước'], ['Cột chi tiết', 'Không xuất; xem ở màn hình nhật ký']];
    for (const [k, v] of [['Hành động', query.action], ['Tên đăng nhập', query.username], ['Kết quả', query.outcome], ['Mô-đun', query.module && MODULE_TEXT[query.module]], ['Loại', query.type && TYPE_TEXT[query.type]], ['Đối tượng', query.targetType], ['Mã đối tượng', query.targetId], ['Từ', query.from?.toISOString()], ['Đến', query.to?.toISOString()]] as const) {
      if (v) info.push([k, v]);
    }
    if (truncated) info.push(['Lưu ý', `Chỉ xuất ${rows.length} bản ghi mới nhất; hãy thu hẹp bộ lọc để xuất đủ.`]);
    const file = await buildExportFile(
      'nhat-ky',
      {
        title: 'NHẬT KÝ THAY ĐỔI HỆ THỐNG',
        info,
        generatedAt: this.clock.now(),
        sheets: [
          {
            name: 'Nhật ký',
            columns: [
              { header: 'Mã', width: 8, align: 'right' },
              { header: 'Thời điểm (giờ VN)', width: 22 },
              { header: 'Người thao tác', width: 18 },
              { header: 'Mô-đun', width: 12 },
              { header: 'Loại', width: 14 },
              { header: 'Hành động', width: 28 },
              { header: 'Kết quả', width: 10 },
              { header: 'Đối tượng', width: 16 },
              { header: 'Mã đối tượng', width: 38 },
              { header: 'IP', width: 16 },
            ],
            rows: rows.map((r) => [r.id, vnTime(r.occurredAt), r.actorUsername ?? '', MODULE_TEXT[r.module] ?? r.module, TYPE_TEXT[r.type] ?? r.type, r.action, r.outcome === 'SUCCESS' ? 'Thành công' : 'Thất bại', r.targetType ?? '', r.targetId ?? '', r.ip ?? '']),
          },
        ],
      },
      format,
    );
    await this.record({
      action: 'audit.export',
      outcome: 'SUCCESS',
      details: { format, rows: rows.length, truncated, bytes: file.buffer.length, filter: { action: query.action, username: query.username, outcome: query.outcome, module: query.module, type: query.type, targetType: query.targetType, targetId: query.targetId, from: query.from, to: query.to } },
    });
    return file;
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
