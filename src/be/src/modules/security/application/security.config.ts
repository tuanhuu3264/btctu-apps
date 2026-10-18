/** Tham số bảo mật, đọc từ biến môi trường trong SecurityModule (ADR-011 mục 1, 2). */
export class SecurityConfig {
  maxFailedAttempts = 5;
  lockMinutes = 15;
  sessionTtlHours = 8;
  /** Tự đóng phiên khi không thao tác quá số phút này (ADR-057); chỉ "giữ phiên" từ trình duyệt mới được tính là thao tác. */
  sessionIdleMinutes = 30;
  minPasswordLength = 12;
  cookieName = 'sid';
  /** Bật ở môi trường thật chạy HTTPS. */
  cookieSecure = false;
  /**
   * off: không dùng MFA; optional: ai đã đăng ký thì phải nhập mã, ai chưa thì đăng nhập như cũ (mặc định, để phát triển và thử nghiệm);
   * required: vai trò quản trị phải đăng ký và nhập mã (bắt buộc khi vận hành thật, ADR-048).
   */
  mfaMode: 'off' | 'optional' | 'required' = 'optional';
  /** Khóa AES-256 mã hóa khóa TOTP và ký thẻ thử thách; đặt qua MFA_ENCRYPTION_KEY (64 ký tự hex). */
  mfaKey: Buffer = Buffer.alloc(32, 7);
  mfaIssuer = 'KPI-OKR Ban To chuc Tinh uy Dak Lak';
  /** Thời hạn của thẻ thử thách giữa bước mật khẩu và bước nhập mã. */
  mfaChallengeMinutes = 5;
}
