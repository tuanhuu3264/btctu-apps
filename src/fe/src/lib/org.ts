import type { OrgUnit } from './api';

/** Một người đang giữ vị trí trong sơ đồ tổ chức. */
export interface Holder {
  personId: string;
  fullName: string;
  title: string;
  unitName: string;
  positionId: string;
  reportsToPositionId: string | null;
}

export function holdersOf(tree: OrgUnit[]): Holder[] {
  return tree.flatMap((u) =>
    u.positions.flatMap((p) =>
      p.holder ? [{ personId: p.holder.personId, fullName: p.holder.fullName, title: p.title, unitName: u.name, positionId: p.id, reportsToPositionId: p.reportsToPositionId }] : [],
    ),
  );
}

/** Các cấp trên của một cán bộ, từ cấp trên trực tiếp lên gốc (bỏ vị trí đang trống). */
export function superiorsOf(tree: OrgUnit[], personId: string): Holder[] {
  const positions = new Map(tree.flatMap((u) => u.positions.map((p) => [p.id, { p, unitName: u.name }] as const)));
  const start = [...positions.values()].find((x) => x.p.holder?.personId === personId);
  const chain: Holder[] = [];
  for (let next = start?.p.reportsToPositionId ? positions.get(start.p.reportsToPositionId) : undefined; next; ) {
    const { p, unitName } = next;
    if (p.holder) chain.push({ personId: p.holder.personId, fullName: p.holder.fullName, title: p.title, unitName, positionId: p.id, reportsToPositionId: p.reportsToPositionId });
    next = p.reportsToPositionId ? positions.get(p.reportsToPositionId) : undefined;
  }
  return chain;
}

export const holderLabel = (h: Holder) => `${h.fullName} – ${h.title}, ${h.unitName}`;
