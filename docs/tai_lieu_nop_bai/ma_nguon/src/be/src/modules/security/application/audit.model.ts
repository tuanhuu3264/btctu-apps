import type { AuditModule, AuditType } from './audit-classify.js';

export const AUDIT_OUTCOMES = ['SUCCESS', 'DENIED', 'FAILURE'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Mã băm của "bản ghi số 0" để dòng đầu tiên có điểm tựa. */
export const GENESIS_HASH = '0'.repeat(64);

export interface AuditActor {
  id: string;
  username: string;
}

/** Điều lớp nghiệp vụ muốn ghi. Thời gian, ngữ cảnh request và mã băm do AuditService bổ sung. */
export interface AuditEntryInput {
  action: string;
  outcome: AuditOutcome;
  /** Mặc định suy từ `action` (xem `classifyAction`); nêu rõ khi cần phân loại khác. */
  module?: AuditModule;
  type?: AuditType;
  /** Mặc định lấy từ ngữ cảnh request; truyền rõ khi chưa có (ví dụ đăng nhập). */
  actor?: AuditActor | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

export interface AuditRecordDraft {
  occurredAt: Date;
  actorAccountId: string | null;
  actorUsername: string | null;
  action: string;
  outcome: AuditOutcome;
  /** Bản ghi cũ (hashVersion 1) không lưu; khi đọc thì suy từ `action`. */
  module: AuditModule;
  type: AuditType;
  /** 1: mã băm chưa gồm module/type (bản ghi trước A5); 2: có. */
  hashVersion: number;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  requestId: string | null;
  ip: string | null;
  prevHash: string;
  hash: string;
}

export interface AuditRecord extends AuditRecordDraft {
  /** bigint của PostgreSQL, dạng chuỗi. Thứ tự tăng dần là thứ tự chuỗi băm. */
  id: string;
}

export interface AuditQuery {
  action?: string;
  actorId?: string;
  /** Tên đăng nhập của người thực hiện (khớp đúng). */
  username?: string;
  outcome?: AuditOutcome;
  module?: AuditModule;
  type?: AuditType;
  targetType?: string;
  targetId?: string;
  /** Từ thời điểm này (gồm cả) đến trước thời điểm `to`. */
  from?: Date;
  to?: Date;
  /** Chỉ lấy bản ghi có id nhỏ hơn giá trị này (phân trang lùi). */
  beforeId?: string;
  limit?: number;
}

export interface AuditVerification {
  valid: boolean;
  checked: number;
  lastId: string | null;
  lastHash: string;
  firstInvalidId?: string;
  reason?: string;
}
