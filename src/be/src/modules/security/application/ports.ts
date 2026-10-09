import type { AuditQuery, AuditRecord, AuditRecordDraft } from './audit.model.js';
import type { AccountSummary, NewRoleAssignment, RoleAssignmentModel } from './authorization.model.js';
import type {
  AccountModel,
  AccountStatus,
  Credentials,
  CurrentAccount,
  LoginState,
  NewAccount,
  NewSession,
  SessionModel,
} from './security.model.js';

/** Các cổng của lớp nghiệp vụ. Là abstract class để làm token dependency injection. */
export abstract class AccountRepository {
  abstract findById(id: string): Promise<AccountModel | null>;
  abstract findByUsername(username: string): Promise<AccountModel | null>;
  abstract findByPersonId(personId: string): Promise<AccountModel | null>;
  abstract findAll(): Promise<AccountSummary[]>;
  abstract create(data: NewAccount): Promise<AccountModel>;
  abstract updateLoginState(id: string, state: LoginState): Promise<void>;
  abstract setStatus(id: string, status: AccountStatus): Promise<void>;
  abstract setPersonId(id: string, personId: string | null): Promise<void>;
}

export abstract class SessionRepository {
  abstract create(data: NewSession): Promise<SessionModel>;
  abstract findByTokenHash(tokenHash: string): Promise<SessionModel | null>;
  abstract revoke(tokenHash: string, at: Date): Promise<void>;
  abstract revokeAllForAccount(accountId: string, at: Date): Promise<void>;
}

export abstract class RoleAssignmentRepository {
  abstract create(data: NewRoleAssignment): Promise<RoleAssignmentModel>;
  abstract findById(id: string): Promise<RoleAssignmentModel | null>;
  /** Toàn bộ gán vai trò của tài khoản, kể cả đã thu hồi hoặc hết hạn (lịch sử). */
  abstract findByAccount(accountId: string): Promise<RoleAssignmentModel[]>;
  abstract revoke(id: string, at: Date): Promise<void>;
}

export abstract class AuditLogRepository {
  /**
   * Ghi thêm một bản ghi. Phải tuần tự hóa các lần ghi: lấy mã băm của bản ghi cuối, gọi `build`
   * để tạo bản ghi nối vào đó, rồi chèn, trong một khối không xen kẽ (ADR-011 mục 7).
   */
  abstract append(build: (prevHash: string) => AuditRecordDraft): Promise<AuditRecord>;
  /** Mới nhất trước. */
  abstract find(query: AuditQuery): Promise<AuditRecord[]>;
  /** Tăng dần theo id, để kiểm tra chuỗi băm theo lô. */
  abstract findAfter(afterId: string | null, limit: number): Promise<AuditRecord[]>;
}

export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  abstract verify(hash: string, plain: string): Promise<boolean>;
}

/**
 * Cơ chế xác thực. Hiện chỉ có mật khẩu; thêm MFA sau này bằng cách thay hoặc bọc
 * lớp triển khai, không sửa nơi dùng (ADR-011 mục 3).
 */
export abstract class Authenticator {
  /** Ném UnauthorizedException khi thất bại. */
  abstract authenticate(credentials: Credentials): Promise<CurrentAccount>;
}
