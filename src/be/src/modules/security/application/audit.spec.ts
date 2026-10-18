import { Test } from '@nestjs/testing';
import { Clock } from '../../../common/clock.js';
import { requestContext } from '../../../common/request-context.js';
import { AccountService } from './account.service.js';
import { AUDIT_HASH_VERSION, canonicalJson, computeAuditHash, sanitizeDetails } from './audit-hash.js';
import { GENESIS_HASH } from './audit.model.js';
import { AuditService } from './audit.service.js';
import { AuthorizationService } from './authorization.service.js';
import { AuthService } from './auth.service.js';
import type { LoginResult } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordAuthenticator } from './password-authenticator.js';
import {
  AccountRepository,
  AuditLogRepository,
  Authenticator,
  MfaRepository,
  PasswordHasher,
  RoleAssignmentRepository,
  SessionRepository,
} from './ports.js';
import { RoleService } from './role.service.js';
import { SecurityConfig } from './security.config.js';
import { SessionService } from './session.service.js';
import {
  FakeClock,
  FakeHasher,
  InMemoryAccounts,
  InMemoryAuditLog,
  InMemoryMfa,
  InMemoryRoleAssignments,
  InMemorySessions,
} from './testing/in-memory.js';

const PASSWORD = 'mat-khau-dai-hon-12-ky-tu';

describe('hàm băm của nhật ký', () => {
  it('JSON ổn định: không phụ thuộc thứ tự khóa, bỏ undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, undefined] }, z: undefined })).toBe('{"a":{"c":[3,null],"d":2},"b":1}');
  });

  it('che khóa nhạy cảm ở mọi độ sâu và cắt chuỗi quá dài', () => {
    const out = sanitizeDetails({
      username: 'a',
      password: 'bi-mat',
      nested: { token: 't', passwordHash: 'h', ok: 1 },
      list: [{ secret: 's' }],
      long: 'x'.repeat(600),
    }) as Record<string, any>;
    expect(out.password).toBe('[REDACTED]');
    expect(out.nested).toEqual({ token: '[REDACTED]', passwordHash: '[REDACTED]', ok: 1 });
    expect(out.list[0].secret).toBe('[REDACTED]');
    expect(out.username).toBe('a');
    expect(out.long.length).toBeLessThan(510);
  });

  it('đổi bất kỳ trường nào cũng làm đổi mã băm', () => {
    const base = {
      occurredAt: new Date('2026-10-03T08:00:00Z'),
      actorAccountId: 'a1',
      actorUsername: 'u',
      action: 'x',
      outcome: 'SUCCESS' as const,
      targetType: null,
      targetId: null,
      details: { k: 1 },
      requestId: null,
      ip: null,
      prevHash: GENESIS_HASH,
    };
    const h = computeAuditHash(base);
    expect(computeAuditHash({ ...base })).toBe(h);
    expect(computeAuditHash({ ...base, action: 'y' })).not.toBe(h);
    expect(computeAuditHash({ ...base, outcome: 'DENIED' })).not.toBe(h);
    expect(computeAuditHash({ ...base, details: { k: 2 } })).not.toBe(h);
    expect(computeAuditHash({ ...base, prevHash: 'f'.repeat(64) })).not.toBe(h);
  });

  it('hashVersion 1 giữ công thức cũ (không gồm module, type); hashVersion 2 có hai trường này', () => {
    const base = {
      occurredAt: new Date('2026-10-03T08:00:00Z'),
      actorAccountId: 'a1',
      actorUsername: 'u',
      action: 'unit.update',
      outcome: 'SUCCESS' as const,
      targetType: 'unit',
      targetId: 'x',
      details: { k: 1 },
      requestId: null,
      ip: null,
      prevHash: GENESIS_HASH,
    };
    const legacy = computeAuditHash(base);
    // Bản ghi cũ: module và type được suy khi đọc nên không làm đổi mã băm.
    expect(computeAuditHash({ ...base, hashVersion: 1, module: 'organization', type: 'UPDATE' })).toBe(legacy);
    expect(computeAuditHash({ ...base, hashVersion: 1, module: 'catalog', type: 'DELETE' })).toBe(legacy);
    const v2 = computeAuditHash({ ...base, hashVersion: 2, module: 'organization', type: 'UPDATE' });
    expect(v2).not.toBe(legacy);
    expect(computeAuditHash({ ...base, hashVersion: 2, module: 'catalog', type: 'UPDATE' })).not.toBe(v2);
    expect(computeAuditHash({ ...base, hashVersion: 2, module: 'organization', type: 'DELETE' })).not.toBe(v2);
  });
});

describe('AuditService: chuỗi băm', () => {
  let repo: InMemoryAuditLog;
  let audit: AuditService;

  beforeEach(async () => {
    repo = new InMemoryAuditLog();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: AuditLogRepository, useValue: repo },
        { provide: Clock, useClass: FakeClock },
      ],
    }).compile();
    audit = moduleRef.get(AuditService);
  });

  async function write(n: number) {
    for (let i = 0; i < n; i++) await audit.record({ action: `test.${i}`, outcome: 'SUCCESS', details: { i } });
  }

  it('bản ghi đầu nối vào mã băm gốc, các bản ghi sau nối vào nhau', async () => {
    await write(3);
    expect(repo.rows[0].prevHash).toBe(GENESIS_HASH);
    expect(repo.rows[1].prevHash).toBe(repo.rows[0].hash);
    expect(repo.rows[2].prevHash).toBe(repo.rows[1].hash);
  });

  it('chuỗi nguyên vẹn thì kiểm tra hợp lệ; chuỗi rỗng cũng hợp lệ', async () => {
    expect(await audit.verify()).toMatchObject({ valid: true, checked: 0, lastId: null, lastHash: GENESIS_HASH });
    await write(5);
    expect(await audit.verify()).toMatchObject({ valid: true, checked: 5, lastId: '5' });
  });

  it('ghi module và type: suy từ action, hoặc theo giá trị nơi gọi nêu rõ; hashVersion hiện hành', async () => {
    const a = await audit.record({ action: 'unit.deactivate', outcome: 'SUCCESS', targetType: 'unit', targetId: 'u1' });
    expect(a).toMatchObject({ module: 'organization', type: 'STATUS_CHANGE', hashVersion: AUDIT_HASH_VERSION });
    const b = await audit.record({ action: 'unit.deactivate', outcome: 'SUCCESS', module: 'system', type: 'OTHER' });
    expect(b).toMatchObject({ module: 'system', type: 'OTHER' });
    expect(await audit.verify()).toMatchObject({ valid: true, checked: 2 });
  });

  it('chuỗi có cả bản ghi cũ (hashVersion 1) lẫn mới vẫn xác minh được; sửa module/type của bản ghi mới bị phát hiện', async () => {
    // Bản ghi cũ: công thức không gồm module/type, module/type chỉ là giá trị suy ra khi đọc.
    const legacyDraft = {
      occurredAt: new Date('2026-10-01T08:00:00Z'),
      actorAccountId: null,
      actorUsername: null,
      action: 'person.update',
      outcome: 'SUCCESS' as const,
      module: 'organization' as const,
      type: 'UPDATE' as const,
      hashVersion: 1,
      targetType: 'person',
      targetId: 'p1',
      details: null,
      requestId: null,
      ip: null,
      prevHash: GENESIS_HASH,
    };
    await repo.append(() => ({ ...legacyDraft, hash: computeAuditHash(legacyDraft) }));
    await audit.record({ action: 'unit.update', outcome: 'SUCCESS', targetType: 'unit', targetId: 'u1' });
    expect(await audit.verify()).toMatchObject({ valid: true, checked: 2 });

    repo.rows[1].module = 'catalog';
    expect(await audit.verify()).toMatchObject({ valid: false, firstInvalidId: '2' });
    repo.rows[1].module = 'organization';
    repo.rows[1].type = 'DELETE';
    expect(await audit.verify()).toMatchObject({ valid: false, firstInvalidId: '2' });
  });

  it('lọc theo module, type, đối tượng; xem lịch sử của một đối tượng', async () => {
    await audit.record({ action: 'unit.create', outcome: 'SUCCESS', targetType: 'unit', targetId: 'u1' });
    await audit.record({ action: 'unit.update', outcome: 'SUCCESS', targetType: 'unit', targetId: 'u1' });
    await audit.record({ action: 'unit.update', outcome: 'SUCCESS', targetType: 'unit', targetId: 'u2' });
    await audit.record({ action: 'catalog.item.update', outcome: 'SUCCESS', targetType: 'catalog_item', targetId: 'i1' });

    expect((await audit.find({ module: 'organization' })).map((r) => r.action)).toEqual(['unit.update', 'unit.update', 'unit.create']);
    expect(await audit.find({ module: 'organization', type: 'CREATE' })).toHaveLength(1);
    expect(await audit.find({ type: 'UPDATE' })).toHaveLength(3);
    expect((await audit.historyOf('unit', 'u1')).map((r) => r.action)).toEqual(['unit.update', 'unit.create']);
    expect(await audit.historyOf('unit', 'khong-co')).toEqual([]);
  });

  it('phát hiện sửa nội dung một bản ghi ở giữa', async () => {
    await write(5);
    repo.rows[2].details = { i: 999 };
    expect(await audit.verify()).toMatchObject({ valid: false, firstInvalidId: '3', checked: 2 });
  });

  it('phát hiện xóa một bản ghi ở giữa', async () => {
    await write(5);
    repo.rows.splice(2, 1);
    const result = await audit.verify();
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/xóa hoặc chèn/);
  });

  it('phát hiện sửa cả nội dung lẫn mã băm của bản ghi (chuỗi sau đó đứt)', async () => {
    await write(4);
    repo.rows[1].action = 'test.gia-mao';
    repo.rows[1].hash = computeAuditHash(repo.rows[1]);
    expect(await audit.verify()).toMatchObject({ valid: false, firstInvalidId: '3' });
  });

  it('không phát hiện được việc cắt bớt bản ghi cuối (cần đối chiếu lastHash đã lưu ngoài)', async () => {
    await write(4);
    const before = await audit.verify();
    repo.rows.pop();
    const after = await audit.verify();
    expect(after.valid).toBe(true);
    expect(after.lastHash).not.toBe(before.lastHash);
  });

  it('lấy người thực hiện, mã yêu cầu và IP từ ngữ cảnh request', async () => {
    const ctx = { requestId: '11111111-1111-4111-8111-111111111111', ip: '10.0.0.5', actor: null };
    await requestContext.run(ctx, async () => {
      requestContext.setActor({ id: 'a1', username: 'nguyenvana' });
      await audit.record({ action: 'unit.create', outcome: 'SUCCESS' });
    });
    expect(repo.rows[0]).toMatchObject({
      actorAccountId: 'a1',
      actorUsername: 'nguyenvana',
      requestId: ctx.requestId,
      ip: '10.0.0.5',
    });
  });

  it('actor truyền rõ thì ưu tiên hơn ngữ cảnh; null nghĩa là không có người thực hiện', async () => {
    const ctx = { requestId: '11111111-1111-4111-8111-111111111111', ip: null, actor: { id: 'a1', username: 'x' } };
    await requestContext.run(ctx, async () => {
      await audit.record({ action: 'auth.login.failure', outcome: 'FAILURE', actor: null });
    });
    expect(repo.rows[0].actorAccountId).toBeNull();
  });

  it('không bao giờ ghi mật khẩu dù nơi gọi vô tình đưa vào', async () => {
    await audit.record({ action: 'x', outcome: 'SUCCESS', details: { password: 'mat-khau-that', note: 'ok' } });
    expect(JSON.stringify(repo.rows[0])).not.toContain('mat-khau-that');
  });

  it('giới hạn số bản ghi trả về', async () => {
    await write(5);
    expect(await audit.find({ limit: 2 })).toHaveLength(2);
    expect(await audit.find({ limit: 99999 })).toHaveLength(5);
  });

  it('lọc theo kết quả, tên đăng nhập, khoảng thời gian; liệt kê các hành động đã ghi', async () => {
    await audit.record({ action: 'a.one', outcome: 'SUCCESS', actor: { id: 'u1', username: 'an' } });
    await audit.record({ action: 'a.two', outcome: 'DENIED', actor: { id: 'u2', username: 'binh' } });
    await audit.record({ action: 'a.one', outcome: 'FAILURE', actor: { id: 'u1', username: 'an' } });

    expect((await audit.find({ outcome: 'DENIED' })).map((r) => r.action)).toEqual(['a.two']);
    expect(await audit.find({ username: 'an' })).toHaveLength(2);
    expect(await audit.find({ username: 'an', outcome: 'FAILURE' })).toHaveLength(1);
    expect(await audit.find({ username: 'khong-co' })).toEqual([]);

    const at = repo.rows[0].occurredAt;
    expect(await audit.find({ from: new Date(at.getTime() + 1) })).toEqual([]);
    expect(await audit.find({ to: new Date(at.getTime() - 1) })).toEqual([]);
    expect(await audit.find({ from: at, to: new Date(at.getTime() + 1) })).toHaveLength(3);

    expect(await audit.actions()).toEqual(['a.one', 'a.two']);
  });
});

describe('các sự kiện nghiệp vụ được ghi nhật ký', () => {
  let clock: FakeClock;
  let accountsRepo: InMemoryAccounts;
  let log: InMemoryAuditLog;
  let accountService: AccountService;
  let roleService: RoleService;
  let auth: AuthService;
  let config: SecurityConfig;

  beforeEach(async () => {
    clock = new FakeClock();
    accountsRepo = new InMemoryAccounts();
    log = new InMemoryAuditLog();
    config = new SecurityConfig();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountService,
        RoleService,
        AuthService,
        SessionService,
        AuditService,
        AuthorizationService,
        MfaService,
        { provide: MfaRepository, useClass: InMemoryMfa },
        { provide: SecurityConfig, useValue: config },
        { provide: Clock, useValue: clock },
        { provide: PasswordHasher, useClass: FakeHasher },
        { provide: AccountRepository, useValue: accountsRepo },
        { provide: SessionRepository, useClass: InMemorySessions },
        { provide: RoleAssignmentRepository, useClass: InMemoryRoleAssignments },
        { provide: AuditLogRepository, useValue: log },
        { provide: Authenticator, useClass: PasswordAuthenticator },
      ],
    }).compile();
    accountService = moduleRef.get(AccountService);
    roleService = moduleRef.get(RoleService);
    auth = moduleRef.get(AuthService);
  });

  it('tạo tài khoản, cấp và thu hồi vai trò đều để lại dấu vết kèm đối tượng', async () => {
    const admin = await accountService.create({ username: 'quantri', password: PASSWORD });
    const grant = await roleService.grant(null, { accountId: admin.id, role: 'QUAN_TRI_HE_THONG' });
    await roleService.revoke(admin.id, grant.id);

    expect(log.actions()).toEqual(['account.create', 'role.grant', 'role.revoke']);
    expect(log.rows[1]).toMatchObject({ targetId: admin.id, details: { role: 'QUAN_TRI_HE_THONG', bootstrap: true } });
  });

  it('đăng nhập thành công ghi người thực hiện; đăng xuất ghi khi có ngữ cảnh', async () => {
    await accountService.create({ username: 'quantri', password: PASSWORD });
    const { account, session } = (await auth.login({ username: 'quantri', password: PASSWORD })) as LoginResult;
    expect(log.rows.at(-1)).toMatchObject({ action: 'auth.login.success', actorUsername: 'quantri', actorAccountId: account.id });

    await requestContext.run({ requestId: '11111111-1111-4111-8111-111111111111', ip: null, actor: { id: account.id, username: 'quantri' } }, () =>
      auth.logout(session.token),
    );
    expect(log.rows.at(-1)).toMatchObject({ action: 'auth.logout', actorUsername: 'quantri' });
  });

  it('đăng nhập sai ghi lý do thật vào nhật ký nhưng không ghi mật khẩu', async () => {
    await accountService.create({ username: 'quantri', password: PASSWORD });
    await auth.login({ username: 'quantri', password: 'thu-mat-khau-sai' }).catch(() => undefined);
    await auth.login({ username: 'khong-co', password: 'abc' }).catch(() => undefined);

    expect(log.rows.filter((r) => r.action === 'auth.login.failure').map((r) => r.details?.reason)).toEqual([
      'bad-password',
      'unknown-or-disabled',
    ]);
    expect(JSON.stringify(log.rows)).not.toContain('thu-mat-khau-sai');
  });

  it('ghi sự kiện khóa tài khoản và đăng nhập bị từ chối khi đang khóa', async () => {
    await accountService.create({ username: 'quantri', password: PASSWORD });
    for (let i = 0; i < config.maxFailedAttempts; i++) {
      await auth.login({ username: 'quantri', password: 'sai' }).catch(() => undefined);
    }
    expect(log.actions()).toContain('auth.account.locked');

    await auth.login({ username: 'quantri', password: PASSWORD }).catch(() => undefined);
    expect(log.rows.at(-1)?.details?.reason).toBe('locked');
  });

  it('chuỗi băm vẫn nguyên vẹn sau toàn bộ các sự kiện trên', async () => {
    const audit = new AuditService(log, clock);
    const a = await accountService.create({ username: 'quantri', password: PASSWORD });
    await roleService.grant(null, { accountId: a.id, role: 'QUAN_TRI_HE_THONG' });
    await auth.login({ username: 'quantri', password: 'sai' }).catch(() => undefined);
    await auth.login({ username: 'quantri', password: PASSWORD });
    expect(await audit.verify()).toMatchObject({ valid: true, checked: 4 });
  });
});
