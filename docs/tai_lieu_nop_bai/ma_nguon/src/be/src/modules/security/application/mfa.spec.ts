import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Clock } from '../../../common/clock.js';
import { AccountService } from './account.service.js';
import { AuditService } from './audit.service.js';
import { AuthorizationService } from './authorization.service.js';
import { AuthService } from './auth.service.js';
import type { LoginResult, MfaPending } from './auth.service.js';
import { decryptSecret, encryptSecret, hashRecoveryCode, openChallenge, signChallenge } from './mfa-crypto.js';
import { MfaService } from './mfa.service.js';
import { PasswordAuthenticator } from './password-authenticator.js';
import { AccountRepository, AuditLogRepository, Authenticator, MfaRepository, PasswordHasher, RoleAssignmentRepository, SessionRepository } from './ports.js';
import { RoleService } from './role.service.js';
import { SecurityConfig } from './security.config.js';
import { SessionService } from './session.service.js';
import { FakeClock, FakeHasher, InMemoryAccounts, InMemoryAuditLog, InMemoryMfa, InMemoryRoleAssignments, InMemorySessions } from './testing/in-memory.js';
import { base32Decode, base32Encode, codeAtStep, generateSecret, otpauthUri, stepAt, verifyTotp } from './totp.js';

const PASSWORD = 'mat-khau-dai-hon-12-ky-tu';

describe('TOTP (RFC 6238)', () => {
  // Vector kiểm thử của RFC 6238 Phụ lục B (SHA-1, khóa ASCII "12345678901234567890"), rút gọn còn 6 chữ số.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('mã tại giây %i là %s', (seconds, expected) => {
    expect(codeAtStep(secret, stepAt(seconds * 1000))).toBe(expected);
  });

  it('base32 đi và về giữ nguyên dữ liệu', () => {
    const data = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(data))).toEqual(data);
    expect(() => base32Decode('abc1')).toThrow();
  });

  it('chấp nhận lệch một bước, từ chối lệch hai bước, từ chối mã đã dùng, từ chối định dạng sai', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(secret, codeAtStep(secret, step), now, null)).toBe(step);
    expect(verifyTotp(secret, codeAtStep(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, codeAtStep(secret, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, codeAtStep(secret, step - 2), now, null)).toBeNull();
    expect(verifyTotp(secret, codeAtStep(secret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
  });

  it('khóa sinh ra dài 160 bit và địa chỉ otpauth có đủ tham số', () => {
    expect(base32Decode(generateSecret())).toHaveLength(20);
    const uri = otpauthUri('ABC', 'quan tri', 'Ban To chuc');
    expect(uri).toContain('otpauth://totp/Ban%20To%20chuc:quan%20tri');
    expect(uri).toContain('secret=ABC');
    expect(uri).toContain('digits=6');
  });
});

describe('mã hóa khóa và thẻ thử thách', () => {
  const key = Buffer.alloc(32, 9);
  it('mã hóa rồi giải mã, sai khóa hoặc bị sửa thì lỗi', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(stored).not.toContain('JBSWY3DP');
    expect(decryptSecret(stored, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decryptSecret(stored, Buffer.alloc(32, 1))).toThrow();
    expect(() => decryptSecret(stored.slice(0, -2) + 'AA', key)).toThrow();
  });

  it('thẻ thử thách: đúng thì mở được; hết hạn, sửa nội dung hoặc sai khóa thì không', () => {
    const token = signChallenge({ a: 'acc', p: 'VERIFY', e: 2000 }, key);
    expect(openChallenge(token, key, 1000)).toEqual({ a: 'acc', p: 'VERIFY', e: 2000 });
    expect(openChallenge(token, key, 2000)).toBeNull();
    expect(openChallenge(token, Buffer.alloc(32, 1), 1000)).toBeNull();
    const forged = Buffer.from(JSON.stringify({ a: 'khac', p: 'VERIFY', e: 2000 })).toString('base64url') + '.' + token.split('.')[1];
    expect(openChallenge(forged, key, 1000)).toBeNull();
    expect(openChallenge('rac', key, 1000)).toBeNull();
  });

  it('mã khôi phục được chuẩn hóa trước khi băm', () => {
    expect(hashRecoveryCode('AB12C-34DEF')).toBe(hashRecoveryCode('ab12c34def'));
  });
});

describe('luồng MFA (lớp nghiệp vụ)', () => {
  let accounts: InMemoryAccounts;
  let mfaRows: InMemoryMfa;
  let clock: FakeClock;
  let config: SecurityConfig;
  let log: InMemoryAuditLog;
  let sessionRepo: InMemorySessions;
  let accountService: AccountService;
  let roles: RoleService;
  let auth: AuthService;
  let mfa: MfaService;

  beforeEach(async () => {
    accounts = new InMemoryAccounts();
    mfaRows = new InMemoryMfa();
    clock = new FakeClock();
    config = new SecurityConfig();
    log = new InMemoryAuditLog();
    sessionRepo = new InMemorySessions();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountService,
        RoleService,
        AuthService,
        SessionService,
        MfaService,
        AuditService,
        AuthorizationService,
        { provide: SecurityConfig, useValue: config },
        { provide: Clock, useValue: clock },
        { provide: PasswordHasher, useClass: FakeHasher },
        { provide: AccountRepository, useValue: accounts },
        { provide: SessionRepository, useValue: sessionRepo },
        { provide: MfaRepository, useValue: mfaRows },
        { provide: RoleAssignmentRepository, useClass: InMemoryRoleAssignments },
        { provide: AuditLogRepository, useValue: log },
        { provide: Authenticator, useClass: PasswordAuthenticator },
      ],
    }).compile();
    accountService = moduleRef.get(AccountService);
    roles = moduleRef.get(RoleService);
    auth = moduleRef.get(AuthService);
    mfa = moduleRef.get(MfaService);
  });

  const login = (username: string) => auth.login({ username, password: PASSWORD });
  const secretOf = (accountId: string) => decryptSecret(mfaRows.rows.find((r) => r.accountId === accountId)!.secretEnc, config.mfaKey);
  const codeNow = (accountId: string, offsetSteps = 0) => codeAtStep(secretOf(accountId), stepAt(clock.now().getTime()) + offsetSteps);

  /** Đăng ký thiết bị cho tài khoản (đã đăng nhập thường); trả về các mã khôi phục. */
  async function enroll(username: string) {
    const acc = (await accounts.findByUsername(username))!;
    await mfa.beginEnrollment(acc);
    return mfa.confirmEnrollment(acc, codeNow(acc.id));
  }

  describe('chế độ optional (mặc định)', () => {
    beforeEach(async () => {
      await accountService.create({ username: 'canbo', password: PASSWORD });
    });

    it('chưa đăng ký MFA thì đăng nhập như cũ', async () => {
      expect((await login('canbo')).mfa).toBeUndefined();
    });

    it('đăng ký xong: đăng nhập chỉ trả thẻ thử thách, chưa có phiên', async () => {
      await enroll('canbo');
      const result = (await login('canbo')) as MfaPending;
      expect(result.mfa).toBe('VERIFY');
      expect(result.challenge).toBeTruthy();
      expect(sessionRepo.rows).toHaveLength(0);
    });

    it('nhập đúng mã thì mở phiên; mã đã dùng không dùng lại; mã sai bị ghi nhật ký', async () => {
      await enroll('canbo');
      clock.advanceMinutes(1); // sang bước thời gian mới sau mã dùng khi đăng ký
      const acc = (await accounts.findByUsername('canbo'))!;
      const pending = (await login('canbo')) as MfaPending;
      const challenged = await mfa.accountFromChallenge(pending.challenge, 'VERIFY');
      const code = codeNow(acc.id);
      await mfa.verifyLogin(challenged, code);
      expect(((await auth.openSession(challenged)) as LoginResult).session.token).toBeTruthy();
      await expect(mfa.verifyLogin(challenged, code)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(log.rows.some((r) => r.action === 'auth.mfa.failure')).toBe(true);
    });

    it('thẻ thử thách sai bước hoặc hết hạn bị từ chối', async () => {
      await enroll('canbo');
      const pending = (await login('canbo')) as MfaPending;
      await expect(mfa.accountFromChallenge(pending.challenge, 'ENROLL')).rejects.toBeInstanceOf(UnauthorizedException);
      clock.advanceMinutes(config.mfaChallengeMinutes + 1);
      await expect(mfa.accountFromChallenge(pending.challenge, 'VERIFY')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('sai mã đủ ngưỡng thì khóa tạm, và đăng nhập lại bằng mật khẩu không xóa bộ đếm', async () => {
      await enroll('canbo');
      const acc = (await accounts.findByUsername('canbo'))!;
      for (let i = 0; i < config.maxFailedAttempts - 1; i++) {
        await expect(mfa.verifyLogin(acc, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
        await login('canbo'); // đăng nhập lại bằng mật khẩu đúng
      }
      expect(accounts.rows[0].failedAttempts).toBe(config.maxFailedAttempts - 1);
      await expect(mfa.verifyLogin(acc, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(accounts.rows[0].lockedUntil).not.toBeNull();
      // Đang khóa: ngay cả mã đúng cũng bị từ chối.
      await expect(mfa.verifyLogin(acc, codeNow(acc.id, 1))).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('mã khôi phục dùng được một lần', async () => {
      const codes = await enroll('canbo');
      const acc = (await accounts.findByUsername('canbo'))!;
      expect(codes).toHaveLength(10);
      await mfa.verifyLogin(acc, codes[0]);
      await expect(mfa.verifyLogin(acc, codes[0])).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await mfa.status(acc.id)).recoveryCodesLeft).toBe(9);
    });

    it('khóa trong cơ sở dữ liệu là bản mã, không phải khóa gốc', async () => {
      await enroll('canbo');
      const acc = (await accounts.findByUsername('canbo'))!;
      expect(mfaRows.rows[0].secretEnc).not.toContain(secretOf(acc.id));
    });

    it('đăng ký lần hai bị từ chối; xác nhận sai mã không bật MFA', async () => {
      const acc = (await accounts.findByUsername('canbo'))!;
      await mfa.beginEnrollment(acc);
      await expect(mfa.confirmEnrollment(acc, '000000')).rejects.toBeInstanceOf(UnauthorizedException);
      expect((await mfa.status(acc.id)).enabled).toBe(false);
      await mfa.confirmEnrollment(acc, codeNow(acc.id));
      await expect(mfa.beginEnrollment(acc)).rejects.toBeInstanceOf(ConflictException);
    });

    it('tự tắt MFA cần mật khẩu và mã; sai mật khẩu thì không tắt được', async () => {
      await enroll('canbo');
      clock.advanceMinutes(1);
      const acc = (await accounts.findByUsername('canbo'))!;
      await expect(mfa.disableSelf(acc, 'sai-mat-khau', codeNow(acc.id))).rejects.toBeInstanceOf(UnauthorizedException);
      await mfa.disableSelf(acc, PASSWORD, codeNow(acc.id));
      expect((await mfa.status(acc.id)).enabled).toBe(false);
      expect((await login('canbo')).mfa).toBeUndefined();
    });

    it('quản trị đặt lại MFA: xóa thiết bị, thu hồi phiên, ghi nhật ký', async () => {
      await enroll('canbo');
      const acc = (await accounts.findByUsername('canbo'))!;
      await sessionRepo.create({ accountId: acc.id, tokenHash: 'x', expiresAt: new Date('2027-01-01') });
      await mfa.reset({ id: 'admin', username: 'quantri', personId: null }, acc.id);
      expect(mfaRows.rows).toHaveLength(0);
      expect(sessionRepo.rows[0].revokedAt).not.toBeNull();
      expect(log.rows.at(-1)).toMatchObject({ action: 'account.mfa.reset', targetId: acc.id });
    });
  });

  describe('chế độ required', () => {
    beforeEach(async () => {
      config.mfaMode = 'required';
      const admin = await accountService.create({ username: 'quantri', password: PASSWORD });
      await roles.grant(null, { accountId: admin.id, role: 'QUAN_TRI_HE_THONG' });
      const clerk = await accountService.create({ username: 'chuyenvien', password: PASSWORD });
      await roles.grant(null, { accountId: clerk.id, role: 'CHUYEN_VIEN' });
    });

    it('vai trò quản trị chưa đăng ký bị buộc đăng ký; vai trò thường thì không', async () => {
      expect(((await login('quantri')) as MfaPending).mfa).toBe('ENROLL');
      expect((await login('chuyenvien')).mfa).toBeUndefined();
    });

    it('quản trị đã đăng ký thì bước sau là nhập mã và không tự tắt được', async () => {
      await enroll('quantri');
      expect(((await login('quantri')) as MfaPending).mfa).toBe('VERIFY');
      const acc = (await accounts.findByUsername('quantri'))!;
      clock.advanceMinutes(1);
      await expect(mfa.disableSelf(acc, PASSWORD, codeNow(acc.id))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('chế độ off bỏ qua MFA kể cả khi đã đăng ký', async () => {
      await enroll('quantri');
      config.mfaMode = 'off';
      expect((await login('quantri')).mfa).toBeUndefined();
    });
  });
});
