/** Phạm vi áp dụng của một công việc trong danh mục (ADR-021): rỗng cả hai danh sách là việc chung. */
export interface ItemScope {
  unitIds: readonly string[];
  positionIds: readonly string[];
}

/**
 * Công việc có giao được cho người đang giữ vị trí này không: việc chung giao được cho mọi người; việc có phạm vi
 * chỉ giao cho vị trí nằm trong danh sách, hoặc vị trí thuộc đơn vị trong danh sách.
 */
export function isInScope(scope: ItemScope, target: { unitId: string; positionId: string } | null): boolean {
  if (scope.unitIds.length === 0 && scope.positionIds.length === 0) return true;
  if (!target) return false;
  return scope.unitIds.includes(target.unitId) || scope.positionIds.includes(target.positionId);
}
