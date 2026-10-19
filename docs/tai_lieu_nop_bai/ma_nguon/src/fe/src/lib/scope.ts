import type { OrgUnit } from './api';

/** Phạm vi áp dụng của một công việc trong danh mục (ADR-021): thiếu hoặc rỗng cả hai là việc chung. */
export interface ScopeLike {
  unitIds?: string[];
  positionIds?: string[];
}

export interface Placement {
  unitId: string;
  positionId: string;
}

/** Công việc có giao được cho người đang giữ vị trí này không; cùng quy tắc với máy chủ. */
export function inScope(scope: ScopeLike, target: Placement | null): boolean {
  const units = scope.unitIds ?? [];
  const positions = scope.positionIds ?? [];
  if (units.length === 0 && positions.length === 0) return true;
  if (!target) return false;
  return units.includes(target.unitId) || positions.includes(target.positionId);
}

/** Đơn vị và vị trí cán bộ đang giữ theo sơ đồ tổ chức, hoặc null nếu chưa có vị trí. */
export function placementOf(tree: OrgUnit[], personId: string | null | undefined): Placement | null {
  if (!personId) return null;
  for (const unit of tree) {
    const position = unit.positions.find((p) => p.holder?.personId === personId);
    if (position) return { unitId: unit.id, positionId: position.id };
  }
  return null;
}

export const isRestricted = (scope: ScopeLike) => (scope.unitIds?.length ?? 0) > 0 || (scope.positionIds?.length ?? 0) > 0;
