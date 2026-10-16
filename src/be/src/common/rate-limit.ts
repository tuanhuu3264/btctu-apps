import { Logger } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Giới hạn tần suất cửa sổ cố định, lưu trong bộ nhớ của tiến trình (ADR-032).
 *
 * Phù hợp một máy chủ ứng dụng. Chạy nhiều bản ứng dụng sau bộ cân bằng tải thì mỗi bản đếm riêng, khi đó nên đặt
 * giới hạn ở tường lửa ứng dụng web phía trước.
 */
export interface Hit {
  allowed: boolean;
  /** Số giây phải chờ nếu bị chặn. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();
  private sinceSweep = 0;

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Đã chạm giới hạn chưa (không tính thêm lượt). */
  check(key: string): Hit {
    const w = this.live(key);
    if (!w || w.count < this.max) return { allowed: true, retryAfterSeconds: 0 };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - this.now()) / 1000)) };
  }

  /** Tính một lượt, trả về trạng thái sau khi tính. */
  hit(key: string): Hit {
    this.sweepSometimes();
    const t = this.now();
    let w = this.live(key);
    if (!w) {
      w = { count: 0, resetAt: t + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    if (w.count > this.max) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
    return { allowed: true, retryAfterSeconds: 0 };
  }

  get size(): number {
    return this.windows.size;
  }

  private live(key: string): Window | undefined {
    const w = this.windows.get(key);
    if (w && w.resetAt <= this.now()) {
      this.windows.delete(key);
      return undefined;
    }
    return w;
  }

  /** Dọn các cửa sổ đã hết hạn để bảng không phình ra khi bị quét nhiều địa chỉ. */
  private sweepSometimes(): void {
    if (++this.sinceSweep < 500) return;
    this.sinceSweep = 0;
    const t = this.now();
    for (const [key, w] of this.windows) if (w.resetAt <= t) this.windows.delete(key);
  }
}

export interface RateLimitRule {
  /** Tên dùng trong nhật ký cảnh báo. */
  name: string;
  max: number;
  windowMs: number;
  /** Chỉ áp dụng cho request thỏa điều kiện; mặc định mọi request. */
  match?: (req: Request) => boolean;
  /**
   * true: chỉ đếm các lượt bị từ chối (mã 400 trở lên), dùng cho đăng nhập để người dùng đăng nhập đúng không bị tính.
   * Lượt đã bị chặn thì không tính thêm.
   */
  failuresOnly?: boolean;
}

const keyOf = (req: Request) => req.ip ?? 'unknown';

/** Middleware Express áp dụng một luật; trả 429 kèm `Retry-After` khi vượt giới hạn. */
export function rateLimit(rule: RateLimitRule, now: () => number = Date.now): RequestHandler {
  const limiter = new FixedWindowLimiter(rule.max, rule.windowMs, now);
  const logger = new Logger(`RateLimit:${rule.name}`);
  const warned = new Map<string, number>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (rule.match && !rule.match(req)) return next();
    const key = keyOf(req);

    const blocked = (retryAfterSeconds: number) => {
      // Ghi cảnh báo một lần mỗi cửa sổ cho mỗi địa chỉ, tránh làm đầy nhật ký khi bị tấn công liên tục.
      const t = now();
      if ((warned.get(key) ?? 0) <= t) {
        warned.set(key, t + rule.windowMs);
        logger.warn(`Chặn ${key}: vượt ${rule.max} lượt trong ${Math.round(rule.windowMs / 1000)} giây`);
      }
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ statusCode: 429, error: 'Too Many Requests', message: `Quá nhiều yêu cầu, thử lại sau ${retryAfterSeconds} giây` });
    };

    if (rule.failuresOnly) {
      const state = limiter.check(key);
      if (!state.allowed) return blocked(state.retryAfterSeconds);
      res.on('finish', () => {
        if (res.statusCode >= 400) limiter.hit(key);
      });
      return next();
    }

    const result = limiter.hit(key);
    if (!result.allowed) return blocked(result.retryAfterSeconds);
    next();
  };
}
