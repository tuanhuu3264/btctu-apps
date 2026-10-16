import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { AuditService } from './audit.service.js';
import { isEffective, isLive, ROLES } from './authorization.model.js';
import type { AccountSummary, Role, RoleAssignmentModel } from './authorization.model.js';
import { AccountRepository, RoleAssignmentRepository } from './ports.js';
import { EXCLUSIVE_ROLES } from './role-permissions.js';
import type { CurrentAccount } from './security.model.js';

export interface GrantRoleInput {
  accountId: string;
  role: Role;
  validFrom?: Date;
  validTo?: Date | null;
}

@Injectable()
export class RoleService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly assignments: RoleAssignmentRepository,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async list(accountId: string): Promise<RoleAssignmentModel[]> {
    const rows = await this.assignments.findByAccount(accountId);
    await this.audit.record({ action: 'role.list', outcome: 'SUCCESS', targetType: 'account', targetId: accountId });
    return rows;
  }

  /** Mọi vai trò đang có hiệu lực của các tài khoản còn hoạt động. Dùng cho rà soát quyền (ADR-044); không ghi nhật ký riêng. */
  async listEffective(): Promise<{ assignment: RoleAssignmentModel; account: AccountSummary }[]> {
    const now = this.clock.now();
    const accounts = new Map((await this.accounts.findAll()).filter((a) => a.status === 'ACTIVE').map((a) => [a.id, a]));
    return (await this.assignments.findLive(now))
      .filter((a) => isEffective(a, now) && accounts.has(a.accountId))
      .map((assignment) => ({ assignment, account: accounts.get(assignment.accountId)! }));
  }

  /**
   * Cấp vai trò. `grantor` là null chỉ khi cấp bằng lệnh khởi tạo.
   * Quy tắc: không tự cấp cho mình; không trùng vai trò đang có; vai trò quản trị đứng riêng.
   */
  async grant(grantor: CurrentAccount | null, input: GrantRoleInput): Promise<RoleAssignmentModel> {
    if (!ROLES.includes(input.role)) {
      throw new BadRequestException(`Vai trò không hợp lệ: ${input.role}`);
    }
    if (grantor && grantor.id === input.accountId) {
      throw new ForbiddenException('Không được tự cấp vai trò cho chính mình');
    }
    const target = await this.accounts.findById(input.accountId);
    if (!target) throw new NotFoundException(`Không tìm thấy tài khoản: ${input.accountId}`);
    if (target.status !== 'ACTIVE') throw new ConflictException('Tài khoản đã bị vô hiệu hóa');

    const now = this.clock.now();
    const validFrom = input.validFrom ?? now;
    const validTo = input.validTo ?? null;
    if (validTo !== null && validTo <= validFrom) {
      throw new BadRequestException('Thời điểm hết hạn phải sau thời điểm bắt đầu');
    }
    if (validTo !== null && validTo <= now) {
      throw new BadRequestException('Thời điểm hết hạn đã qua');
    }

    const liveRoles = (await this.assignments.findByAccount(input.accountId)).filter((a) => isLive(a, now)).map((a) => a.role);
    if (liveRoles.includes(input.role)) {
      throw new ConflictException(`Tài khoản đã có vai trò ${input.role}`);
    }
    const combined = new Set<Role>([...liveRoles, input.role]);
    if (combined.size > 1 && [...combined].some((r) => EXCLUSIVE_ROLES.includes(r))) {
      throw new ConflictException('Vai trò quản trị phải đứng riêng, không đi kèm vai trò khác');
    }

    const created = await this.assignments.create({
      accountId: input.accountId,
      role: input.role,
      validFrom,
      validTo,
      grantedBy: grantor?.id ?? null,
    });
    await this.audit.record({
      action: 'role.grant',
      outcome: 'SUCCESS',
      // Cấp bằng lệnh khởi tạo thì chưa có ngữ cảnh request; người cấp ghi rõ là hệ thống.
      actor: grantor ? { id: grantor.id, username: grantor.username } : undefined,
      targetType: 'account',
      targetId: input.accountId,
      details: { assignmentId: created.id, role: input.role, validFrom, validTo, bootstrap: grantor === null },
    });
    return created;
  }

  async revoke(accountId: string, assignmentId: string): Promise<void> {
    const assignment = await this.assignments.findById(assignmentId);
    if (!assignment || assignment.accountId !== accountId) {
      throw new NotFoundException(`Không tìm thấy phân quyền: ${assignmentId}`);
    }
    if (!assignment.revokedAt) {
      await this.assignments.revoke(assignmentId, this.clock.now());
      await this.audit.record({
        action: 'role.revoke',
        outcome: 'SUCCESS',
        targetType: 'account',
        targetId: accountId,
        details: { assignmentId, role: assignment.role },
      });
    }
  }
}
