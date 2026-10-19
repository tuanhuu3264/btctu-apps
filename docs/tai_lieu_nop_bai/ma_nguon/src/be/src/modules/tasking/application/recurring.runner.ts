import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { RecurringService } from './recurring.service.js';

/** Lần chạy đầu sau khi khởi động (chạy bù các lần lặp đã qua khi hệ thống tắt), rồi cứ mỗi khoảng `RECURRING_INTERVAL_MINUTES` (mặc định 60). */
const FIRST_RUN_DELAY_MS = 30_000;

/**
 * Bộ chạy nền của việc lặp định kỳ (ADR-046), nằm trong tiến trình ứng dụng, không cần thư viện lập lịch. Tắt bằng
 * `RECURRING_AUTORUN=false` (test, hoặc khi chạy bằng lệnh ngoài). Chạy trùng giữa nhiều tiến trình vô hại vì CSDL chặn sinh trùng.
 */
@Injectable()
export class RecurringRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringRunner.name);
  private first?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly recurring: RecurringService) {}

  onModuleInit(): void {
    if (process.env.RECURRING_AUTORUN === 'false') return;
    const minutes = Number(process.env.RECURRING_INTERVAL_MINUTES ?? 60);
    const intervalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000;
    this.first = setTimeout(() => void this.tick(), FIRST_RUN_DELAY_MS);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.recurring.run();
      if (result.created > 0 || result.errors.length > 0) {
        this.logger.log(`Việc lặp: ${result.templates} mẫu, sinh ${result.created} việc, ${result.errors.length} lỗi`);
      }
    } catch (e) {
      this.logger.error(`Không chạy được bộ sinh việc lặp: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
