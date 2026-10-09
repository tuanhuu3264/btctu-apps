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
  revokedAt: Date | null;
}

export type NewSession = Pick<SessionModel, 'accountId' | 'tokenHash' | 'expiresAt'>;

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
