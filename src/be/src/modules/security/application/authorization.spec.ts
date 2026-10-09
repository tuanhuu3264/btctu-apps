import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Clock } from '../../../common/clock.js';
import { AccountService } from './account.service.js';
import { AuditService } from './audit.service.js';
import { AuthorizationService } from './authorization.service.js';
import { PERMISSIONS, ROLES } from './authorization.model.js';
import {
  AccountRepository,
  AuditLogRepository,
  PasswordHasher,
  RoleAssignmentRepository,
  SessionRepository,
} from './ports.js';
import { EXCLUSIVE_ROLES, ROLE_PERMISSIONS } from './role-permissions.js';
import { RoleService } from './role.service.js';
import { SecurityConfig } from './security.config.js';
import type { CurrentAccount } from './security.model.js';
import {
  FakeClock,
  FakeHasher,
  InMemoryAccounts,
  InMemoryAuditLog,
  InMemoryRoleAssignments,
  InMemorySessions,
} from './testing/in-memory.js';

const PASSWORD = 'mat-khau-dai-hon-12-ky-tu';

describe('ma trận vai trò – quyền', () => {
  it('mọi vai trò đều có khai báo và chỉ chứa quyền hợp lệ', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  it('mọi quyền đều được ít nhất một vai trò nắm giữ', () => {
    const held = new Set(ROLES.flatMap((r) => ROLE_PERMISSIONS[r]));
    for (const p of PERMISSIONS) expect(held.has(p)).toBe(true);
  });

  it('vai trò nghiệp vụ không có quyền quản trị tài khoản hay phân quyền', () => {
    const adminOnly = ['account:create', 'account:disable', 'role:assign'];
    for (const role of ROLES.filter((r) => !EXCLUSIVE_ROLES.includes(r))) {
      for (const p of adminOnly) expect(ROLE_PERMISSIONS[role]).not.toContain(p);
    }
  });

  it('quản trị dữ liệu chỉ xem, không cấp quyền hay tạo/vô hiệu hóa tài khoản', () => {
    expect(ROLE_PERMISSIONS.QUAN_TRI_DU_LIEU).not.toContain('role:assign');
    expect(ROLE_PERMISSIONS.QUAN_TRI_DU_LIEU).not.toContain('account:create');
  });
});

describe('cấp vai trò và kiểm quyền', () => {
  let clock: FakeClock;
  let accounts: InMemoryAccounts;
  let sessions: InMemorySessions;
  let accountService: AccountService;
  let roleService: RoleService;
  let authorization: AuthorizationService;
  let admin: CurrentAccount;
  let user: CurrentAccount;

  beforeEach(async () => {
    clock = new FakeClock();
    accounts = new InMemoryAccounts();
    sessions = new InMemorySessions();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountService,
        RoleService,
        AuthorizationService,
        AuditService,
        { provide: AuditLogRepository, useClass: InMemoryAuditLog },
        { provide: SecurityConfig, useValue: new SecurityConfig() },
        { provide: Clock, useValue: clock },
        { provide: PasswordHasher, useClass: FakeHasher },
        { provide: AccountRepository, useValue: accounts },
        { provide: SessionRepository, useValue: sessions },
        { provide: RoleAssignmentRepository, useClass: InMemoryRoleAssignments },
      ],
    }).compile();
    accountService = moduleRef.get(AccountService);
    roleService = moduleRef.get(RoleService);
    authorization = moduleRef.get(AuthorizationService);

    admin = await accountService.create({ username: 'quantri', password: PASSWORD });
    await roleService.grant(null, { accountId: admin.id, role: 'QUAN_TRI_HE_THONG' });
    user = await accountService.create({ username: 'nguyenvana', password: PASSWORD });
  });

  it('tài khoản chưa có vai trò thì không có quyền nào', async () => {
    expect(await authorization.accessOf(user.id)).toEqual({ roles: [], permissions: [] });
  });

  it('quyền là hợp của các vai trò đang có hiệu lực', async () => {
    await roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' });
    await roleService.grant(admin, { accountId: user.id, role: 'VAN_PHONG' });
    const access = await authorization.accessOf(user.id);
    expect(access.roles.sort()).toEqual(['CHUYEN_VIEN', 'VAN_PHONG']);
    expect(access.permissions).toContain('org:manage');
  });

  it('vai trò chưa tới hạn bắt đầu chưa có hiệu lực, hết hạn thì mất hiệu lực', async () => {
    const from = new Date(clock.now().getTime() + 60 * 60_000);
    const to = new Date(from.getTime() + 60 * 60_000);
    await roleService.grant(admin, { accountId: user.id, role: 'VAN_PHONG', validFrom: from, validTo: to });

    expect((await authorization.accessOf(user.id)).roles).toEqual([]);
    clock.advanceMinutes(61);
    expect((await authorization.accessOf(user.id)).roles).toEqual(['VAN_PHONG']);
    clock.advanceMinutes(60);
    expect((await authorization.accessOf(user.id)).roles).toEqual([]);
  });

  it('thu hồi làm vai trò mất hiệu lực ngay, thu hồi hai lần không lỗi', async () => {
    const a = await roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' });
    await roleService.revoke(user.id, a.id);
    await roleService.revoke(user.id, a.id);
    expect((await authorization.accessOf(user.id)).roles).toEqual([]);
  });

  it('không thu hồi qua tài khoản khác', async () => {
    const a = await roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' });
    await expect(roleService.revoke(admin.id, a.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('không tự cấp vai trò cho chính mình', async () => {
    await expect(roleService.grant(admin, { accountId: admin.id, role: 'TRUONG_BAN' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('từ chối cấp trùng vai trò đang có', async () => {
    await roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' });
    await expect(roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('vai trò quản trị đứng riêng: không cấp kèm vai trò khác, theo cả hai chiều', async () => {
    await roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' });
    await expect(roleService.grant(admin, { accountId: user.id, role: 'QUAN_TRI_DU_LIEU' })).rejects.toBeInstanceOf(
      ConflictException,
    );

    const other = await accountService.create({ username: 'quantridulieu', password: PASSWORD });
    await roleService.grant(admin, { accountId: other.id, role: 'QUAN_TRI_DU_LIEU' });
    await expect(roleService.grant(admin, { accountId: other.id, role: 'QUAN_TRI_HE_THONG' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(roleService.grant(admin, { accountId: other.id, role: 'CHUYEN_VIEN' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('cấp lại được sau khi vai trò cũ đã thu hồi', async () => {
    const a = await roleService.grant(admin, { accountId: user.id, role: 'QUAN_TRI_DU_LIEU' });
    await roleService.revoke(user.id, a.id);
    await expect(roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' })).resolves.toBeDefined();
  });

  it('từ chối thời hạn sai và tài khoản không tồn tại hoặc đã vô hiệu hóa', async () => {
    const past = new Date(clock.now().getTime() - 1000);
    await expect(
      roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN', validTo: past }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(roleService.grant(admin, { accountId: 'khong-co', role: 'CHUYEN_VIEN' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await accountService.disable(admin, user.id);
    await expect(roleService.grant(admin, { accountId: user.id, role: 'CHUYEN_VIEN' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('vô hiệu hóa tài khoản thu hồi mọi phiên và không cho tự vô hiệu hóa', async () => {
    await sessions.create({ accountId: user.id, tokenHash: 'x'.repeat(64), expiresAt: new Date('2027-01-01') });
    await accountService.disable(admin, user.id);
    expect(sessions.rows[0].revokedAt).not.toBeNull();
    expect(accounts.rows.find((a) => a.id === user.id)?.status).toBe('DISABLED');
    await expect(accountService.disable(admin, admin.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
