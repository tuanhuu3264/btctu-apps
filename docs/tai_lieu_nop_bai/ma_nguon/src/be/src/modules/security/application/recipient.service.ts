import { Injectable } from '@nestjs/common';
import type { Permission } from './authorization.model.js';
import { AuthorizationService } from './authorization.service.js';
import { AccountRepository } from './ports.js';

/** Tra cứu người nhận thông báo theo quyền (ADR-029). Không ghi nhật ký vì không trả dữ liệu ra ngoài. */
@Injectable()
export class RecipientService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Mã cán bộ của các tài khoản đang hoạt động, đã gắn cán bộ và đang có quyền `permission`. */
  async personIdsWithPermission(permission: Permission): Promise<string[]> {
    const result = new Set<string>();
    for (const a of await this.accounts.findAll()) {
      if (a.status !== 'ACTIVE' || !a.personId) continue;
      if ((await this.authorization.permissionsOf(a.id)).has(permission)) result.add(a.personId);
    }
    return [...result];
  }
}
