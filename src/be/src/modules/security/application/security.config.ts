/** Tham số bảo mật, đọc từ biến môi trường trong SecurityModule (ADR-011 mục 1, 2). */
export class SecurityConfig {
  maxFailedAttempts = 5;
  lockMinutes = 15;
  sessionTtlHours = 8;
  minPasswordLength = 12;
  cookieName = 'sid';
  /** Bật ở môi trường thật chạy HTTPS. */
  cookieSecure = false;
}
