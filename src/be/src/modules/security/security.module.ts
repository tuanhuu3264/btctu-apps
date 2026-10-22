import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Clock, SystemClock } from '../../common/clock.js';
import { AccountService } from './application/account.service.js';
import { AuditService } from './application/audit.service.js';
import { AuthorizationService } from './application/authorization.service.js';
import { AuthService } from './application/auth.service.js';
import { parseKey } from './application/mfa-crypto.js';
import { MfaService } from './application/mfa.service.js';
import { PasswordAuthenticator } from './application/password-authenticator.js';
import {
  AccountRepository,
  AuditLogRepository,
  Authenticator,
  MfaRepository,
  PasswordHasher,
  RoleAssignmentRepository,
  SessionRepository,
} from './application/ports.js';
import { RecipientService } from './application/recipient.service.js';
import { RoleService } from './application/role.service.js';
import { SecurityConfig } from './application/security.config.js';
import { SessionService } from './application/session.service.js';
import { AccountRoleEntity } from './data-access/account-role.entity.js';
import { AccountMfaEntity } from './data-access/account-mfa.entity.js';
import { AccountEntity } from './data-access/account.entity.js';
import { Argon2PasswordHasher } from './data-access/argon2-password-hasher.js';
import { SessionEntity } from './data-access/session.entity.js';
import { PostgresAuditLogRepository } from './data-access/postgres-audit-log.repository.js';
import { TypeOrmAccountRepository } from './data-access/typeorm-account.repository.js';
import { TypeOrmMfaRepository } from './data-access/typeorm-mfa.repository.js';
import { TypeOrmRoleAssignmentRepository } from './data-access/typeorm-role-assignment.repository.js';
import { TypeOrmSessionRepository } from './data-access/typeorm-session.repository.js';
import { AccountController } from './presentation/account.controller.js';
import { AuditController } from './presentation/audit.controller.js';
import { AuthController } from './presentation/auth.controller.js';
import { AuthGuard } from './presentation/auth.guard.js';
import { PermissionsGuard } from './presentation/permissions.guard.js';

function securityConfigFromEnv(env: ConfigService): SecurityConfig {
  const cfg = new SecurityConfig();
  cfg.maxFailedAttempts = Number(env.get('AUTH_MAX_FAILED_ATTEMPTS', cfg.maxFailedAttempts));
  cfg.lockMinutes = Number(env.get('AUTH_LOCK_MINUTES', cfg.lockMinutes));
  cfg.sessionTtlHours = Number(env.get('SESSION_TTL_HOURS', cfg.sessionTtlHours));
  cfg.sessionIdleMinutes = Number(env.get('SESSION_IDLE_MINUTES', cfg.sessionIdleMinutes));
  if (!Number.isFinite(cfg.sessionIdleMinutes) || cfg.sessionIdleMinutes < 5) throw new Error('SESSION_IDLE_MINUTES phải là số từ 5 trở lên');
  cfg.minPasswordLength = Number(env.get('PASSWORD_MIN_LENGTH', cfg.minPasswordLength));
  cfg.cookieSecure = env.get<string>('COOKIE_SECURE', 'false') === 'true';
  const mode = env.get<string>('MFA_MODE', cfg.mfaMode);
  if (mode !== 'off' && mode !== 'optional' && mode !== 'required') throw new Error(`MFA_MODE không hợp lệ: ${mode} (off, optional, required)`);
  cfg.mfaMode = mode;
  const key = env.get<string>('MFA_ENCRYPTION_KEY');
  if (key) cfg.mfaKey = parseKey(key);
  else if (mode === 'required' || (mode !== 'off' && env.get<string>('NODE_ENV') === 'production')) {
    throw new Error('Thiếu MFA_ENCRYPTION_KEY (64 ký tự hex): bắt buộc khi MFA_MODE=required, hoặc khi NODE_ENV=production mà MFA_MODE khác off');
  }
  cfg.mfaIssuer = env.get<string>('MFA_ISSUER', cfg.mfaIssuer);
  return cfg;
}

/** Danh tính tối thiểu, phiên đăng nhập, guard mặc định từ chối (ADR-011). Vai trò và quyền: lát 2. Nhật ký bất biến: lát 3. */
@Module({
  imports: [TypeOrmModule.forFeature([AccountEntity, AccountMfaEntity, SessionEntity, AccountRoleEntity])],
  controllers: [AuthController, AccountController, AuditController],
  providers: [
    AuthService,
    AccountService,
    AuditService,
    AuthorizationService,
    MfaService,
    RoleService,
    RecipientService,
    SessionService,
    { provide: SecurityConfig, inject: [ConfigService], useFactory: securityConfigFromEnv },
    { provide: Clock, useClass: SystemClock },
    { provide: Authenticator, useClass: PasswordAuthenticator },
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: AccountRepository, useClass: TypeOrmAccountRepository },
    { provide: MfaRepository, useClass: TypeOrmMfaRepository },
    { provide: SessionRepository, useClass: TypeOrmSessionRepository },
    { provide: RoleAssignmentRepository, useClass: TypeOrmRoleAssignmentRepository },
    { provide: AuditLogRepository, useClass: PostgresAuditLogRepository },
    // Thứ tự quan trọng: xác thực trước, kiểm quyền sau.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AccountService, AuditService, AuthorizationService, RecipientService, RoleService, SessionService],
})
export class SecurityModule {}
