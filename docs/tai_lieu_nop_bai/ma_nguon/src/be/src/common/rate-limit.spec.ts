import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { parseTrustProxy, proxyMisconfigurationDetector, securityOptionsFromEnv, trustProxyWarning } from './http-security.js';
import { FixedWindowLimiter, rateLimit } from './rate-limit.js';

describe('FixedWindowLimiter', () => {
  let t = 1_000_000;
  const now = () => t;
  beforeEach(() => {
    t = 1_000_000;
  });

  it('cho tối đa `max` lượt trong cửa sổ, lượt kế tiếp bị chặn kèm số giây chờ', () => {
    const l = new FixedWindowLimiter(3, 60_000, now);
    expect([1, 2, 3].map(() => l.hit('a').allowed)).toEqual([true, true, true]);
    t += 10_000;
    expect(l.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });

  it('mỗi khóa đếm riêng và hết cửa sổ thì đếm lại từ đầu', () => {
    const l = new FixedWindowLimiter(1, 1000, now);
    expect(l.hit('a').allowed).toBe(true);
    expect(l.hit('a').allowed).toBe(false);
    expect(l.hit('b').allowed).toBe(true);
    t += 1001;
    expect(l.hit('a').allowed).toBe(true);
  });

  it('check không tính thêm lượt', () => {
    const l = new FixedWindowLimiter(1, 1000, now);
    expect(l.check('a').allowed).toBe(true);
    expect(l.check('a').allowed).toBe(true);
    l.hit('a');
    expect(l.check('a').allowed).toBe(false);
  });

  it('dọn các cửa sổ đã hết hạn để bảng không phình ra', () => {
    const l = new FixedWindowLimiter(5, 1000, now);
    for (let i = 0; i < 600; i++) l.hit(`ip-${i}`);
    expect(l.size).toBe(600);
    t += 2000;
    for (let i = 0; i < 500; i++) l.hit('moi');
    expect(l.size).toBeLessThan(10);
  });
});

describe('rateLimit (middleware)', () => {
  async function serve(rules: Parameters<typeof rateLimit>[0][], login = false) {
    const app = express();
    for (const r of rules) app.use(rateLimit(r));
    app.get('/ping', (_req, res) => void res.json({ ok: true }));
    app.post('/auth/login', (req, res) => void res.status(login ? 200 : 401).json({}));
    const server = app.listen(0);
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => server.close() };
  }

  it('vượt giới hạn thì trả 429 kèm Retry-After và thông báo tiếng Việt', async () => {
    const s = await serve([{ name: 'test', max: 2, windowMs: 60_000 }]);
    try {
      expect((await fetch(`${s.base}/ping`)).status).toBe(200);
      expect((await fetch(`${s.base}/ping`)).status).toBe(200);
      const blocked = await fetch(`${s.base}/ping`);
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await blocked.json()).message).toMatch(/Quá nhiều yêu cầu/);
    } finally {
      s.close();
    }
  });

  it('luật đăng nhập chỉ đếm lần thất bại và chỉ áp dụng cho đường dẫn đăng nhập', async () => {
    const s = await serve([{ name: 'login', max: 2, windowMs: 60_000, failuresOnly: true, match: (req) => req.method === 'POST' && req.path === '/auth/login' }]);
    try {
      const post = () => fetch(`${s.base}/auth/login`, { method: 'POST' });
      expect((await post()).status).toBe(401);
      expect((await post()).status).toBe(401);
      expect((await post()).status).toBe(429); // đã 2 lần sai
      expect((await fetch(`${s.base}/ping`)).status).toBe(200); // đường dẫn khác không bị ảnh hưởng
    } finally {
      s.close();
    }
  });

  it('đăng nhập đúng nhiều lần không bị tính', async () => {
    const s = await serve([{ name: 'login', max: 2, windowMs: 60_000, failuresOnly: true, match: (req) => req.path === '/auth/login' }], true);
    try {
      for (let i = 0; i < 6; i++) expect((await fetch(`${s.base}/auth/login`, { method: 'POST' })).status).toBe(200);
    } finally {
      s.close();
    }
  });
});

describe('đứng sau proxy (TRUST_PROXY)', () => {
  async function serveBehindProxy(trust: string | number | boolean | undefined, logger: { warn: (m: string) => void }) {
    const app = express();
    if (trust !== undefined) app.set('trust proxy', trust);
    app.use(proxyMisconfigurationDetector(trust, logger));
    app.use(rateLimit({ name: 'test', max: 2, windowMs: 60_000 }));
    app.get('/ping', (req, res) => res.json({ ip: req.ip }));
    const server = app.listen(0);
    await once(server, 'listening');
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
  }
  const as = (ip: string) => ({ headers: { 'X-Forwarded-For': ip } });

  it('parseTrustProxy hiểu số lớp, true/false, danh sách địa chỉ và để trống', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('  ')).toBeUndefined();
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });

  it('cảnh báo cấu hình tin mọi proxy hoặc số lớp bất thường', () => {
    expect(trustProxyWarning(true)).toMatch(/giả IP/);
    expect(trustProxyWarning(9)).toMatch(/bất thường/);
    expect(trustProxyWarning(1)).toBeNull();
    expect(trustProxyWarning(undefined)).toBeNull();
    expect(trustProxyWarning('loopback')).toBeNull();
  });

  it('chưa đặt TRUST_PROXY: mọi người dùng sau proxy bị tính chung một IP và có cảnh báo một lần', async () => {
    const warn = vi.fn();
    const s = await serveBehindProxy(undefined, { warn });
    try {
      expect((await fetch(`${s.base}/ping`, as('203.0.113.1'))).status).toBe(200);
      expect((await fetch(`${s.base}/ping`, as('203.0.113.2'))).status).toBe(200);
      expect((await fetch(`${s.base}/ping`, as('203.0.113.3'))).status).toBe(429); // người thứ ba bị chặn dù chưa gọi lần nào
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/TRUST_PROXY chưa đặt/);
    } finally {
      s.close();
    }
  });

  it('đặt TRUST_PROXY=1: mỗi người dùng được đếm theo IP thật, không cảnh báo', async () => {
    const warn = vi.fn();
    const s = await serveBehindProxy(1, { warn });
    try {
      expect(await (await fetch(`${s.base}/ping`, as('203.0.113.1'))).json()).toEqual({ ip: '203.0.113.1' });
      expect((await fetch(`${s.base}/ping`, as('203.0.113.1'))).status).toBe(200);
      expect((await fetch(`${s.base}/ping`, as('203.0.113.1'))).status).toBe(429);
      expect((await fetch(`${s.base}/ping`, as('203.0.113.2'))).status).toBe(200); // người khác không bị liên lụy
      expect(warn).not.toHaveBeenCalled();
    } finally {
      s.close();
    }
  });

  it('không đứng sau proxy thì không cảnh báo', async () => {
    const warn = vi.fn();
    const s = await serveBehindProxy(undefined, { warn });
    try {
      await fetch(`${s.base}/ping`);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      s.close();
    }
  });
});

describe('securityOptionsFromEnv', () => {
  it('mặc định có luật đăng nhập và luật chung; đọc được cấu hình từ môi trường', () => {
    const d = securityOptionsFromEnv({});
    expect(d.frontendOrigin).toBe('http://localhost:3000');
    expect(d.trustProxy).toBeUndefined();
    expect(d.rateLimits).toMatchObject([
      { name: 'login', max: 20, windowMs: 900_000, failuresOnly: true },
      { name: 'global', max: 600, windowMs: 60_000 },
    ]);
    const e = securityOptionsFromEnv({ TRUST_PROXY: '1', RATE_LIMIT_LOGIN_MAX: '5', RATE_LIMIT_GLOBAL_WINDOW_SECONDS: '10', FRONTEND_ORIGIN: 'https://kpi.example.vn' });
    expect(e.trustProxy).toBe(1);
    expect(e.frontendOrigin).toBe('https://kpi.example.vn');
    expect(e.rateLimits).toMatchObject([{ max: 5 }, { windowMs: 10_000 }]);
  });

  it('giá trị không hợp lệ rơi về mặc định; có thể tắt', () => {
    expect(securityOptionsFromEnv({ RATE_LIMIT_LOGIN_MAX: 'abc' }).rateLimits).toMatchObject([{ max: 20 }, {}]);
    expect(securityOptionsFromEnv({ RATE_LIMIT_DISABLED: 'true' }).rateLimits).toBe(false);
  });
});
