import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import QRCode from 'qrcode';
import { Clock } from '../../../common/clock.js';
import { AuditService } from './audit.service.js';
import { AuthorizationService } from './authorization.service.js';
import type { Role } from './authorization.model.js';
import { decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, openChallenge, signChallenge } from './mfa-crypto.js';
import { AccountRepository, MfaRepository, PasswordHasher, SessionRepository } from './ports.js';
import { SecurityConfig } from './security.config.js';
import type { AccountModel, CurrentAccount } from './security.model.js';
import { generateSecret, otpauthUri, verifyTotp } from './totp.js';

/** Vai trò phải dùng MFA khi chế độ `required` (QĐ 342 Điều 7: tài khoản quản trị, dữ liệu nhạy cảm; lộ trình mục 6 thứ tự 1). */
export const MFA_REQUIRED_ROLES: readonly Role[] = ['QUAN_TRI_HE_THONG', 'QUAN_TRI_DU_LIEU', 'DAI_DIEN_THUONG_VU'];

export const INVALID_MFA_MESSAGE = 'Mã xác thực không đúng, hoặc tài khoản tạm thời bị khóa';
const RECOVERY_PATTERN = /^[0-9a-f]{5}-?[0-9a-f]{5}$/i;

export interface MfaStatus {
  mode: SecurityConfig['mfaMode'];
  enabled: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

export interface MfaEnrollment {
  secret: string;
  otpauthUri: string;
  /** Ảnh mã QR dạng data URL (PNG). */
  qrDataUrl: string;
}

export type LoginStep = 'VERIFY' | 'ENROLL';

@Injectable()
export class MfaService {
  constructor(
    private readonly mfa: MfaRepository,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly hasher: PasswordHasher,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly config: SecurityConfig,
  ) {}

  async isRequired(accountId: string): Promise<boolean> {
    if (this.config.mfaMode !== 'required') return false;
    const { roles } = await this.authorization.accessOf(accountId);
    return roles.some((r) => MFA_REQUIRED_ROLES.includes(r));
  }

  /** Bước tiếp theo sau khi mật khẩu đúng: null nếu không cần MFA. */
  async stepAfterPassword(accountId: string): Promise<LoginStep | null> {
    if (this.config.mfaMode === 'off') return null;
    if ((await this.mfa.find(accountId))?.enabled) return 'VERIFY';
    return (await this.isRequired(accountId)) ? 'ENROLL' : null;
  }

  issueChallenge(accountId: string, step: LoginStep): { challenge: string; expiresInSeconds: number } {
    const ttl = this.config.mfaChallengeMinutes * 60_000;
    return { challenge: signChallenge({ a: accountId, p: step, e: this.clock.now().getTime() + ttl }, this.config.mfaKey), expiresInSeconds: ttl / 1000 };
  }

  /** Mở thẻ thử thách; từ chối thẻ sai chữ ký, hết hạn hoặc sai bước. */
  async accountFromChallenge(challenge: string, step: LoginStep): Promise<AccountModel> {
    const payload = openChallenge(challenge, this.config.mfaKey, this.clock.now().getTime());
    const account = payload && payload.p === step ? await this.accounts.findById(payload.a) : null;
    if (!account || account.status !== 'ACTIVE') {
      throw new UnauthorizedException('Phiên xác thực đã hết hạn, hãy đăng nhập lại');
    }
    return account;
  }

  async status(accountId: string): Promise<MfaStatus> {
    const row = await this.mfa.find(accountId);
    return {
      mode: this.config.mfaMode,
      enabled: !!row?.enabled,
      required: await this.isRequired(accountId),
      recoveryCodesLeft: row?.enabled ? row.recoveryHashes.length : 0,
    };
  }

  /** Bắt đầu đăng ký thiết bị: sinh khóa mới (thay khóa đăng ký dở), chưa bật cho tới khi nhập đúng mã đầu tiên. */
  async beginEnrollment(account: Pick<AccountModel, 'id' | 'username'>): Promise<MfaEnrollment> {
    if (this.config.mfaMode === 'off') throw new BadRequestException('Hệ thống không bật xác thực nhiều lớp');
    if ((await this.mfa.find(account.id))?.enabled) throw new ConflictException('Tài khoản đã đăng ký xác thực nhiều lớp');
    const secret = generateSecret();
    await this.mfa.savePending(account.id, encryptSecret(secret, this.config.mfaKey));
    const uri = otpauthUri(secret, account.username, this.config.mfaIssuer);
    return { secret, otpauthUri: uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
  }

  /** Xác nhận bằng mã đầu tiên; trả về các mã khôi phục (hiện đúng một lần). */
  async confirmEnrollment(account: AccountModel, code: string): Promise<string[]> {
    const row = await this.mfa.find(account.id);
    if (!row || row.enabled) throw new BadRequestException('Chưa có thiết bị đang đăng ký, hãy bắt đầu lại');
    await this.assertNotLocked(account);
    const step = verifyTotp(decryptSecret(row.secretEnc, this.config.mfaKey), code, this.clock.now().getTime(), null);
    if (step === null) throw await this.failure(account, 'enroll-bad-code');
    const codes = generateRecoveryCodes();
    await this.mfa.enable(account.id, { recoveryHashes: codes.map(hashRecoveryCode), lastStep: step, at: this.clock.now() });
    await this.resetFailures(account);
    await this.audit.record({
      action: 'auth.mfa.enroll',
      outcome: 'SUCCESS',
      actor: { id: account.id, username: account.username },
      targetType: 'account',
      targetId: account.id,
    });
    return codes;
  }

  /** Kiểm tra mã TOTP hoặc mã khôi phục khi đăng nhập. Ném UnauthorizedException khi sai. */
  async verifyLogin(account: AccountModel, code: string): Promise<void> {
    await this.assertNotLocked(account);
    const row = await this.mfa.find(account.id);
    if (!row?.enabled) throw await this.failure(account, 'not-enrolled');
    const trimmed = code.trim();
    if (RECOVERY_PATTERN.test(trimmed)) {
      const hash = hashRecoveryCode(trimmed);
      if (!row.recoveryHashes.includes(hash)) throw await this.failure(account, 'bad-recovery-code');
      await this.mfa.setRecoveryHashes(account.id, row.recoveryHashes.filter((h) => h !== hash));
      await this.audit.record({
        action: 'auth.mfa.recovery-used',
        outcome: 'SUCCESS',
        actor: { id: account.id, username: account.username },
        targetType: 'account',
        targetId: account.id,
        details: { recoveryCodesLeft: row.recoveryHashes.length - 1 },
      });
    } else {
      const step = verifyTotp(decryptSecret(row.secretEnc, this.config.mfaKey), trimmed, this.clock.now().getTime(), row.lastStep);
      if (step === null) throw await this.failure(account, 'bad-code');
      await this.mfa.setLastStep(account.id, step);
    }
    await this.resetFailures(account);
  }

  /** Tạo bộ mã khôi phục mới (mã cũ mất hiệu lực); cần mã TOTP hiện tại. */
  async regenerateRecoveryCodes(account: AccountModel, code: string): Promise<string[]> {
    await this.verifyLogin(account, code);
    const codes = generateRecoveryCodes();
    await this.mfa.setRecoveryHashes(account.id, codes.map(hashRecoveryCode));
    await this.audit.record({
      action: 'auth.mfa.recovery-regenerate',
      outcome: 'SUCCESS',
      actor: { id: account.id, username: account.username },
      targetType: 'account',
      targetId: account.id,
    });
    return codes;
  }

  /** Tự tắt MFA: cần mật khẩu và mã; không cho tắt khi vai trò của tài khoản bắt buộc dùng MFA. */
  async disableSelf(account: AccountModel, password: string, code: string): Promise<void> {
    if (await this.isRequired(account.id)) throw new ForbiddenException('Vai trò của tài khoản bắt buộc dùng xác thực nhiều lớp, không tự tắt được');
    if (!(await this.hasher.verify(account.passwordHash, password))) throw await this.failure(account, 'bad-password-on-disable');
    await this.verifyLogin(account, code);
    await this.mfa.remove(account.id);
    await this.audit.record({
      action: 'auth.mfa.disable',
      outcome: 'SUCCESS',
      actor: { id: account.id, username: account.username },
      targetType: 'account',
      targetId: account.id,
    });
  }

  /** Quản trị đặt lại MFA khi mất thiết bị: xóa thiết bị, thu hồi phiên; lần đăng nhập sau phải đăng ký lại. */
  async reset(actor: CurrentAccount, accountId: string): Promise<void> {
    const target = await this.accounts.findById(accountId);
    if (!target) throw new NotFoundException(`Không tìm thấy tài khoản: ${accountId}`);
    const had = !!(await this.mfa.find(accountId));
    await this.mfa.remove(accountId);
    await this.sessions.revokeAllForAccount(accountId, this.clock.now());
    await this.accounts.updateLoginState(accountId, { failedAttempts: 0, lockedUntil: null });
    await this.audit.record({
      action: 'account.mfa.reset',
      outcome: 'SUCCESS',
      targetType: 'account',
      targetId: accountId,
      details: { username: target.username, hadDevice: had, by: actor.username },
    });
  }

  private async assertNotLocked(account: AccountModel): Promise<void> {
    const fresh = (await this.accounts.findById(account.id)) ?? account;
    if (fresh.lockedUntil && fresh.lockedUntil > this.clock.now()) throw await this.failure(fresh, 'locked', false);
  }

  /** Đếm lần sai cùng bộ đếm với mật khẩu: đủ ngưỡng thì khóa tạm. Bộ đếm chỉ xóa khi qua đủ cả hai yếu tố. */
  private async failure(account: AccountModel, reason: string, count = true): Promise<UnauthorizedException> {
    const now = this.clock.now();
    if (count) {
      const fresh = (await this.accounts.findById(account.id)) ?? account;
      const failures = fresh.failedAttempts + 1;
      if (failures >= this.config.maxFailedAttempts) {
        const lockedUntil = new Date(now.getTime() + this.config.lockMinutes * 60_000);
        await this.accounts.updateLoginState(account.id, { failedAttempts: 0, lockedUntil });
        await this.audit.record({ action: 'auth.account.locked', outcome: 'SUCCESS', actor: null, targetType: 'account', targetId: account.id, details: { username: account.username, lockedUntil, afterFailures: failures, by: 'mfa' } });
      } else {
        await this.accounts.updateLoginState(account.id, { failedAttempts: failures, lockedUntil: null });
      }
    }
    await this.audit.record({
      action: 'auth.mfa.failure',
      outcome: 'FAILURE',
      actor: null,
      targetType: 'account',
      targetId: account.id,
      details: { username: account.username, reason },
    });
    return new UnauthorizedException(INVALID_MFA_MESSAGE);
  }

  private async resetFailures(account: AccountModel): Promise<void> {
    await this.accounts.updateLoginState(account.id, { failedAttempts: 0, lockedUntil: null });
  }
}
