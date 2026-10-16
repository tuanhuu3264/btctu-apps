import type { AssignmentKind, OrgUnit } from './api';

/** Một người đang giữ vị trí trong sơ đồ tổ chức. */
export interface Holder {
  personId: string;
  fullName: string;
  title: string;
  unitName: string;
  positionId: string;
  reportsToPositionId: string | null;
  kind: AssignmentKind;
}

export function holdersOf(tree: OrgUnit[]): Holder[] {
  return tree.flatMap((u) =>
    u.positions.flatMap((p) =>
      p.holder ? [{ personId: p.holder.personId, fullName: p.holder.fullName, title: p.title, unitName: u.name, positionId: p.id, reportsToPositionId: p.reportsToPositionId, kind: p.holder.kind }] : [],
    ),
  );
}

/** Mỗi cán bộ một dòng (cán bộ kiêm nhiệm giữ nhiều vị trí): ưu tiên vị trí chính, giữ thứ tự gặp đầu tiên. */
export function uniqueByPerson(holders: Holder[]): Holder[] {
  const byPerson = new Map<string, Holder>();
  for (const h of holders) {
    const seen = byPerson.get(h.personId);
    if (!seen || (seen.kind !== 'PRIMARY' && h.kind === 'PRIMARY')) byPerson.set(h.personId, h);
  }
  return [...byPerson.values()];
}

/**
 * Các cấp trên của một cán bộ, từ cấp trên trực tiếp lên gốc (bỏ vị trí đang trống). Nêu `positionId` thì tính từ vị trí đó
 * (cán bộ kiêm nhiệm có chuỗi cấp trên riêng cho từng vị trí); không nêu thì tính từ vị trí chính.
 */
export function superiorsOf(tree: OrgUnit[], personId: string, positionId?: string): Holder[] {
  const positions = new Map(tree.flatMap((u) => u.positions.map((p) => [p.id, { p, unitName: u.name }] as const)));
  const mine = [...positions.values()].filter((x) => x.p.holder?.personId === personId);
  const start = positionId ? positions.get(positionId) : (mine.find((x) => x.p.holder?.kind === 'PRIMARY') ?? mine[0]);
  const chain: Holder[] = [];
  for (let next = start?.p.reportsToPositionId ? positions.get(start.p.reportsToPositionId) : undefined; next; ) {
    const { p, unitName } = next;
    if (p.holder) chain.push({ personId: p.holder.personId, fullName: p.holder.fullName, title: p.title, unitName, positionId: p.id, reportsToPositionId: p.reportsToPositionId, kind: p.holder.kind });
    next = p.reportsToPositionId ? positions.get(p.reportsToPositionId) : undefined;
  }
  return chain;
}

export const holderLabel = (h: Holder) => `${h.fullName} – ${h.title}, ${h.unitName}`;
