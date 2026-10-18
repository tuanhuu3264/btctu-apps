import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Clock } from '../../../common/clock.js';
import { AccountService } from './account.service.js';
import { AuditService } from './audit.service.js';
import { AuthService } from './auth.service.js';
import type { LoginResult } from './auth.service.js';
import { AuthorizationService } from './authorization.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordAuthenticator } from './password-authenticator.js';
import { AccountRepository, AuditLogRepository, Authenticator, MfaRepository, PasswordHasher, RoleAssignmentRepository, SessionRepository } from './ports.js';
import { SecurityConfig } from './security.config.js';
import { SessionService } from './session.service.js';
import { FakeClock, FakeHasher, InMemoryAccounts, InMemoryAuditLog, InMemoryMfa, InMemoryRoleAssignments, InMemorySessions } from './testing/in-memory.js';

const PASSWORD = 'mat-khau-dai-hon-12-ky-tu';

describe('mô-đun security (lớp nghiệp vụ)', () => {
  let accounts: InMemoryAccounts;
  let clock: FakeClock;
  let accountService: AccountService;
  let auth: AuthService;
  let sessions: SessionService;
  let config: SecurityConfig;

  beforeEach(async () => {
    accounts = new InMemoryAccounts();
    clock = new FakeClock();
    config = new SecurityConfig();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountService,
        AuthService,
        AuditService,
        SessionService,
        MfaService,
        AuthorizationService,
        { provide: SecurityConfig, useValue: config },
        { provide: Clock, useValue: clock },
        { provide: PasswordHasher, useClass: FakeHasher },
        { provide: AccountRepository, useValue: accounts },
        { provide: SessionRepository, useClass: InMemorySessions },
        { provide: MfaRepository, useClass: InMemoryMfa },
        { provide: RoleAssignmentRepository, useClass: InMemoryRoleAssignments },
        { provide: AuditLogRepository, useClass: InMemoryAuditLog },
        { provide: Authenticator, useClass: PasswordAuthenticator },
      ],
    }).compile();
    accountService = moduleRef.get(AccountService);
    auth = moduleRef.get(AuthService);
    sessions = moduleRef.get(SessionService);
  });

  describe('tạo tài khoản', () => {
    it('chuẩn hóa tên đăng nhập về chữ thường và không lưu mật khẩu thô', async () => {
      const acc = await accountService.create({ username: '  QuanTri ', password: PASSWORD });
      expect(acc.username).toBe('quantri');
      expect(accounts.rows[0].passwordHash).not.toBe(PASSWORD);
    });

    it('từ chối mật khẩu ngắn, chứa tên đăng nhập, tên sai định dạng, tên trùng', async () => {
      await expect(accountService.create({ username: 'quantri', password: 'ngan' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(accountService.create({ username: 'quantri', password: 'xx-quantri-xx-xx-xx' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(accountService.create({ username: 'a b', password: PASSWORD })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await accountService.create({ username: 'quantri', password: PASSWORD });
      await expect(accountService.create({ username: 'QUANTRI', password: PASSWORD })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('đăng nhập', () => {
    beforeEach(async () => {
      await accountService.create({ username: 'quantri', password: PASSWORD });
    });

    it('đăng nhập đúng cấp phiên dùng được, đăng xuất thu hồi phiên', async () => {
      const { account, session } = (await auth.login({ username: 'QuanTri', password: PASSWORD })) as LoginResult;
      expect(account.username).toBe('quantri');
      expect((await sessions.resolve(session.token))?.id).toBe(account.id);

      await auth.logout(session.token);
      expect(await sessions.resolve(session.token)).toBeNull();
    });

    it('sai mật khẩu và sai tên cho cùng một thông báo', async () => {
      const wrongPassword = await auth.login({ username: 'quantri', password: 'sai' }).catch((e) => e);
      const wrongUser = await auth.login({ username: 'khong-co', password: PASSWORD }).catch((e) => e);
      expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
      expect(wrongUser).toBeInstanceOf(UnauthorizedException);
      expect(wrongPassword.message).toBe(wrongUser.message);
    });

    it('khóa tạm sau số lần sai tối đa, kể cả khi sau đó nhập đúng', async () => {
      for (let i = 0; i < config.maxFailedAttempts; i++) {
        await expect(auth.login({ username: 'quantri', password: 'sai' })).rejects.toBeInstanceOf(UnauthorizedException);
      }
      await expect(auth.login({ username: 'quantri', password: PASSWORD })).rejects.toBeInstanceOf(UnauthorizedException);

      clock.advanceMinutes(config.lockMinutes + 1);
      await expect(auth.login({ username: 'quantri', password: PASSWORD })).resolves.toBeDefined();
    });

    it('đăng nhập đúng xóa bộ đếm sai', async () => {
      await auth.login({ username: 'quantri', password: 'sai' }).catch(() => undefined);
      expect(accounts.rows[0].failedAttempts).toBe(1);
      await auth.login({ username: 'quantri', password: PASSWORD });
      expect(accounts.rows[0].failedAttempts).toBe(0);
    });

    it('tài khoản bị vô hiệu hóa không đăng nhập được và phiên cũ mất hiệu lực', async () => {
      const { session } = (await auth.login({ username: 'quantri', password: PASSWORD })) as LoginResult;
      accounts.rows[0].status = 'DISABLED';
      expect(await sessions.resolve(session.token)).toBeNull();
      await expect(auth.login({ username: 'quantri', password: PASSWORD })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('phiên', () => {
    it('hết hạn theo thời gian và từ chối token lạ hoặc rỗng', async () => {
      const acc = await accountService.create({ username: 'quantri', password: PASSWORD });
      const session = await sessions.issue(acc.id);
      expect(await sessions.resolve(session.token)).not.toBeNull();
      expect(await sessions.resolve('token-la')).toBeNull();
      expect(await sessions.resolve(undefined)).toBeNull();

      clock.advanceMinutes(config.sessionTtlHours * 60 + 1);
      expect(await sessions.resolve(session.token)).toBeNull();
    });

    it('đóng phiên khi không thao tác quá thời hạn, dù chưa hết hạn tuyệt đối (ADR-057)', async () => {
      const acc = await accountService.create({ username: 'quantri', password: PASSWORD });
      const session = await sessions.issue(acc.id);
      clock.advanceMinutes(config.sessionIdleMinutes - 1);
      expect(await sessions.resolve(session.token)).not.toBeNull();
      clock.advanceMinutes(2);
      expect(await sessions.resolve(session.token)).toBeNull();
      expect(await sessions.keepAlive(session.token)).toBeNull(); // phiên đã đóng không "giữ" lại được
    });

    it('giữ phiên gia hạn thời gian không thao tác; gọi API thông thường thì không', async () => {
      const acc = await accountService.create({ username: 'quantri', password: PASSWORD });
      const session = await sessions.issue(acc.id);
      for (let i = 0; i < 4; i += 1) {
        clock.advanceMinutes(config.sessionIdleMinutes - 5);
        expect(await sessions.keepAlive(session.token)).toMatchObject({ idleSecondsLeft: config.sessionIdleMinutes * 60 });
      }
      expect(await sessions.resolve(session.token)).not.toBeNull();

      // Chỉ gọi resolve (như mọi request thông thường, kể cả làm mới định kỳ): không gia hạn.
      for (let i = 0; i < 3; i += 1) {
        clock.advanceMinutes(config.sessionIdleMinutes / 3);
        await sessions.resolve(session.token);
      }
      clock.advanceMinutes(1);
      expect(await sessions.resolve(session.token)).toBeNull();
    });

    it('báo thời gian còn lại; giữ phiên không vượt hạn tuyệt đối của phiên', async () => {
      const acc = await accountService.create({ username: 'quantri', password: PASSWORD });
      const session = await sessions.issue(acc.id);
      clock.advanceMinutes(10);
      expect(await sessions.status(session.token)).toEqual({ idleSecondsLeft: (config.sessionIdleMinutes - 10) * 60, absoluteSecondsLeft: config.sessionTtlHours * 3600 - 600, idleMinutes: config.sessionIdleMinutes });

      // Sát hạn tuyệt đối: còn ít giây hơn thời gian không thao tác thì lấy hạn tuyệt đối.
      await sessions.keepAlive(session.token);
      const endOfDay = config.sessionTtlHours * 60 - 5;
      let elapsed = 10;
      while (elapsed < endOfDay) {
        const step = Math.min(config.sessionIdleMinutes - 5, endOfDay - elapsed);
        clock.advanceMinutes(step);
        elapsed += step;
        await sessions.keepAlive(session.token);
      }
      const near = (await sessions.status(session.token))!;
      expect(near.absoluteSecondsLeft).toBe(300);
      expect(near.idleSecondsLeft).toBe(300);
    });

    it('chỉ lưu băm của token, không lưu token gốc', async () => {
      const acc = await accountService.create({ username: 'quantri', password: PASSWORD });
      const session = await sessions.issue(acc.id);
      const store = (sessions as unknown as { sessions: InMemorySessions }).sessions;
      expect(store.rows[0].tokenHash).not.toBe(session.token);
      expect(store.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
