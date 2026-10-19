import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from './rate-limit.js';
import type { RateLimitRule } from './rate-limit.js';

export interface HttpSecurityOptions {
  /** Nguồn của giao diện; được phép nhúng tệp xem trước từ API (ADR-026). */
  frontendOrigin: string;
  /** Luật giới hạn tần suất; false để tắt (kiểm thử). */
  rateLimits: RateLimitRule[] | false;
  /** Cấu hình `trust proxy` của Express khi đứng sau proxy hoặc bộ cân bằng tải, để lấy đúng địa chỉ IP. */
  trustProxy?: string | number | boolean;
}

/** Đăng nhập và các bước nhập mã MFA dùng chung một giới hạn tần suất, vì cùng là đoán thông tin xác thực. */
const isLogin = (req: Request) => req.method === 'POST' && (req.path.endsWith('/auth/login') || /\/auth\/mfa\/(verify|enroll)\//.test(req.path + '/'));

const intFrom = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * Đọc `TRUST_PROXY`: số lớp proxy (khuyến nghị), danh sách địa chỉ/CIDR hoặc tên nhóm của Express
 * (`loopback`, `linklocal`, `uniquelocal`). Bỏ trống thì không tin tiêu đề `X-Forwarded-For`.
 */
export function parseTrustProxy(raw: string | undefined): string | number | boolean | undefined {
  const value = raw?.trim();
  if (value === undefined || value === '') return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** Cảnh báo cấu hình `trust proxy` có thể sai hoặc bị lợi dụng; trả về nội dung để ghi nhật ký khi khởi động. */
export function trustProxyWarning(trust: HttpSecurityOptions['trustProxy']): string | null {
  if (trust === true) {
    return 'TRUST_PROXY=true tin mọi tiêu đề X-Forwarded-For nên người ngoài có thể giả IP để né giới hạn tần suất; hãy đặt số lớp proxy (ví dụ 1) hoặc danh sách địa chỉ proxy.';
  }
  if (typeof trust === 'number' && trust > 3) {
    return `TRUST_PROXY=${trust} bất thường (thường là 1 đến 2 lớp); đặt thừa lớp cho phép người ngoài giả IP.`;
  }
  return null;
}

/**
 * Khi chưa tin proxy mà vẫn thấy `X-Forwarded-For`, nhiều khả năng đang đứng sau proxy mà thiếu `TRUST_PROXY`,
 * khi đó mọi người dùng bị tính chung một IP. Ghi cảnh báo một lần cho cả tiến trình.
 */
export function proxyMisconfigurationDetector(trust: HttpSecurityOptions['trustProxy'], logger: Pick<Logger, 'warn'> = new Logger('HttpSecurity')) {
  let warned = false;
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!warned && !trust && req.headers['x-forwarded-for']) {
      warned = true;
      logger.warn(
        `Nhận X-Forwarded-For nhưng TRUST_PROXY chưa đặt: giới hạn tần suất và nhật ký đang thấy IP của proxy (${req.socket.remoteAddress ?? 'không rõ'}), mọi người dùng bị tính chung một IP.`,
      );
    }
    next();
  };
}

/** Đọc cấu hình từ biến môi trường, có mặc định (ADR-032). */
export function securityOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): HttpSecurityOptions {
  return {
    frontendOrigin: env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    rateLimits:
      env.RATE_LIMIT_DISABLED === 'true'
        ? false
        : [
            {
              // Chặn dò mật khẩu nhiều tên đăng nhập từ cùng một địa chỉ; bổ sung cho khóa tạm theo tài khoản.
              name: 'login',
              match: isLogin,
              failuresOnly: true,
              max: intFrom(env.RATE_LIMIT_LOGIN_MAX, 20),
              windowMs: intFrom(env.RATE_LIMIT_LOGIN_WINDOW_SECONDS, 900) * 1000,
            },
            {
              name: 'global',
              max: intFrom(env.RATE_LIMIT_GLOBAL_MAX, 600),
              windowMs: intFrom(env.RATE_LIMIT_GLOBAL_WINDOW_SECONDS, 60) * 1000,
            },
          ],
  };
}

/**
 * Tiêu đề bảo mật HTTP và giới hạn tần suất cho API (ADR-032).
 *
 * - Không đặt CSP đầy đủ: API trả JSON và tệp, và giao diện nhúng tệp xem trước bằng iframe, nên chỉ giới hạn
 *   nơi được nhúng (`frame-ancestors`) và không dùng `object-src 'none'` (làm hỏng trình xem PDF của trình duyệt).
 * - `Cache-Control: no-store` mặc định vì dữ liệu đánh giá cán bộ; bộ điều khiển nào đặt riêng thì ghi đè.
 */
export function applyHttpSecurity(app: INestApplication, options: HttpSecurityOptions): void {
  const logger = new Logger('HttpSecurity');
  if (options.trustProxy !== undefined) {
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', options.trustProxy);
    const warning = trustProxyWarning(options.trustProxy);
    if (warning) logger.warn(warning);
  }
  app.use(proxyMisconfigurationDetector(options.trustProxy, logger));
  app.use(
    helmet({
      // Chỉ nêu frame-ancestors, cố ý không có default-src (xem ghi chú trên hàm).
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { 'default-src': helmet.contentSecurityPolicy.dangerouslyDisableDefaultSrc, 'frame-ancestors': ["'self'", options.frontendOrigin] },
      },
      frameguard: false, // thay bằng frame-ancestors ở trên, vì X-Frame-Options không cho phép nêu một nguồn khác
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: { maxAge: 15_552_000, includeSubDomains: true },
    }),
  );
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  if (options.rateLimits) for (const rule of options.rateLimits) app.use(rateLimit(rule));
}
