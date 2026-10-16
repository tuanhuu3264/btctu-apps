import { Injectable } from '@nestjs/common';
import { OrgQueryService, PersonService } from '../../organization/index.js';
import { RoleService } from '../../security/index.js';
import { ReviewOrgDirectory, RoleSource } from '../application/access-review.ports.js';
import type { LiveRole, PersonPlacement } from '../application/access-review.ports.js';

/** Adapter sang mô-đun security: các vai trò đang có hiệu lực và việc thu hồi thật (qua RoleService nên có nhật ký `role.revoke`). */
@Injectable()
export class SecurityRoleSource extends RoleSource {
  constructor(private readonly roles: RoleService) {
    super();
  }

  async liveRoles(): Promise<LiveRole[]> {
    return (await this.roles.listEffective()).map(({ assignment, account }) => ({
      accountId: account.id,
      username: account.username,
      personId: account.personId,
      role: assignment.role,
      roleAssignmentId: assignment.id,
      validFrom: assignment.validFrom,
      validTo: assignment.validTo,
    }));
  }

  revoke(accountId: string, roleAssignmentId: string): Promise<void> {
    return this.roles.revoke(accountId, roleAssignmentId);
  }
}

type TreeUnit = Awaited<ReturnType<OrgQueryService['tree']>>[number];
type TreePosition = TreeUnit['positions'][number];

/** Adapter sang mô-đun organization: dựng từ sơ đồ tổ chức hiện tại, không đụng bảng của mô-đun đó. */
@Injectable()
export class OrganizationReviewDirectory extends ReviewOrgDirectory {
  constructor(
    private readonly org: OrgQueryService,
    private readonly persons: PersonService,
  ) {
    super();
  }

  async placements(personIds: readonly string[]): Promise<Map<string, PersonPlacement>> {
    const tree = await this.org.tree();
    const byPosition = new Map<string, { unit: TreeUnit; position: TreePosition }>();
    const byHolder = new Map<string, { unit: TreeUnit; position: TreePosition }>();
    for (const unit of tree) {
      for (const position of unit.positions) {
        byPosition.set(position.id, { unit, position });
        if (position.holder) byHolder.set(position.holder.personId, { unit, position });
      }
    }

    const out = new Map<string, PersonPlacement>();
    for (const personId of personIds) {
      const place = byHolder.get(personId);
      if (!place) {
        const person = await this.persons.get(personId).catch(() => null);
        out.set(personId, { personName: person?.fullName ?? personId, unitName: null, positionTitle: null, reviewerPersonId: null, reviewerName: null });
        continue;
      }
      const reviewer = reviewerOf(personId, place, byPosition);
      out.set(personId, {
        personName: place.position.holder!.fullName,
        unitName: place.unit.name,
        positionTitle: place.position.title,
        reviewerPersonId: reviewer?.personId ?? null,
        reviewerName: reviewer?.fullName ?? null,
      });
    }
    return out;
  }
}

/**
 * Lãnh đạo xác nhận: người đứng đầu đơn vị (vị trí có số cấp nhỏ nhất đang có người giữ). Nếu chính người đó là
 * người đứng đầu thì lấy cấp trên trực tiếp gần nhất đang có người giữ, theo chuỗi báo cáo.
 */
function reviewerOf(
  personId: string,
  place: { unit: TreeUnit; position: TreePosition },
  byPosition: Map<string, { unit: TreeUnit; position: TreePosition }>,
): { personId: string; fullName: string } | null {
  const head = [...place.unit.positions]
    .filter((p) => p.holder)
    .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code))[0];
  if (head?.holder && head.holder.personId !== personId) return head.holder;

  const seen = new Set<string>();
  for (let next = place.position.reportsToPositionId; next && !seen.has(next); ) {
    seen.add(next);
    const parent = byPosition.get(next);
    if (!parent) return null;
    if (parent.position.holder && parent.position.holder.personId !== personId) return parent.position.holder;
    next = parent.position.reportsToPositionId;
  }
  return null;
}
