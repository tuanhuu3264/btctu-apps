export type AccountStatus = 'ACTIVE' | 'DISABLED';

export interface AccountModel {
  id: string;
  /** Luôn chữ thường, đã chuẩn hóa. */
  username: string;
  passwordHash: string;
  status: AccountStatus;
  failedAttempts: number;
  lockedUntil: Date | null;
  /** Liên kết tới cán bộ trong mô-đun organization (chưa có bảng cán bộ nên chưa ràng buộc khóa ngoại). */
  personId: string | null;
}

export type NewAccount = Pick<AccountModel, 'username' | 'passwordHash' | 'personId'>;

export interface LoginState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface SessionModel {
  id: string;
  accountId: string;
  /** SHA-256 của token; token gốc chỉ nằm trong cookie của người dùng. */
  tokenHash: string;
  expiresAt: Date;
  /** Lần thao tác cuối (đăng nhập hoặc "giữ phiên"); quá hạn không thao tác thì phiên không dùng được nữa (ADR-057). */
  lastActiveAt: Date;
  revokedAt: Date | null;
}

export type NewSession = Pick<SessionModel, 'accountId' | 'tokenHash' | 'expiresAt'> & { lastActiveAt?: Date };

/** Thông tin tài khoản được phép đưa ra ngoài (không có mã băm mật khẩu). */
export interface CurrentAccount {
  id: string;
  username: string;
  personId: string | null;
}

export interface Credentials {
  username: string;
  password: string;
}

/** Thiết bị TOTP của một tài khoản (ADR-048). Khóa chỉ lưu dạng mã hóa. */
export interface MfaModel {
  accountId: string;
  secretEnc: string;
  /** false: đang đăng ký, chưa xác nhận bằng mã đầu tiên. */
  enabled: boolean;
  /** SHA-256 của các mã khôi phục còn dùng được. */
  recoveryHashes: string[];
  /** Bước thời gian của mã được chấp nhận gần nhất, để chặn dùng lại. */
  lastStep: number | null;
  enabledAt: Date | null;
}
