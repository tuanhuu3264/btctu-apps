import { Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock.js';
import { isEffective } from './authorization.model.js';
import type { Permission, Role } from './authorization.model.js';
import { RoleAssignmentRepository } from './ports.js';
import { ROLE_PERMISSIONS } from './role-permissions.js';

export interface EffectiveAccess {
  roles: Role[];
  permissions: Permission[];
}

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly assignments: RoleAssignmentRepository,
    private readonly clock: Clock,
  ) {}

  /** Vai trò và quyền đang có hiệu lực của tài khoản tại thời điểm hiện tại. */
  async accessOf(accountId: string): Promise<EffectiveAccess> {
    const now = this.clock.now();
    const effective = (await this.assignments.findByAccount(accountId)).filter((a) => isEffective(a, now));
    const roles = [...new Set(effective.map((a) => a.role))];
    const permissions = [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]))];
    return { roles, permissions };
  }

  async permissionsOf(accountId: string): Promise<Set<Permission>> {
    return new Set((await this.accessOf(accountId)).permissions);
  }
}
