import { AsyncLocalStorage } from 'node:async_hooks';

export interface ContextActor {
  id: string;
  username: string;
}

/** Thông tin theo từng request, để nhật ký biết ai, từ đâu mà không phải truyền qua mọi hàm. */
export interface RequestContext {
  requestId: string;
  ip: string | null;
  actor: ContextActor | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  /** Gọi sau khi xác thực xong (AuthGuard). Không làm gì nếu ngoài phạm vi request (CLI, test đơn vị). */
  setActor(actor: ContextActor): void {
    const ctx = storage.getStore();
    if (ctx) ctx.actor = actor;
  },
};
