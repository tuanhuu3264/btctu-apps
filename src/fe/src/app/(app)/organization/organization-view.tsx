'use client';

import { Tabs } from 'antd';
import { useMemo } from 'react';
import type { OrgUnit, Person, Position } from '@/lib/api';
import PersonsTab from './persons-tab';
import PositionsTab from './positions-tab';
import UnitsTab from './units-tab';

export interface PositionRow extends Position {
  unitName: string;
  holder: { personId: string; fullName: string } | null;
  reportsToTitle: string | null;
}

export const LEVEL_LABELS: Record<number, string> = {
  1: '1 – Trưởng ban',
  2: '2 – Phó Trưởng ban',
  3: '3 – Trưởng phòng',
  4: '4 – Phó phòng',
  5: '5 – Chuyên viên và tương đương',
};

interface Props {
  tree: OrgUnit[];
  persons: Person[];
  positions: Position[];
}

export default function OrganizationView({ tree, persons, positions }: Props) {
  const rows: PositionRow[] = useMemo(() => {
    const treePositions = tree.flatMap((u) => u.positions.map((p) => ({ ...p, unitName: u.name })));
    const byId = new Map(treePositions.map((p) => [p.id, p]));
    return positions.map((p) => {
      const t = byId.get(p.id);
      return {
        ...p,
        unitName: t?.unitName ?? '–',
        holder: t?.holder ?? null,
        reportsToTitle: p.reportsToPositionId ? (byId.get(p.reportsToPositionId)?.title ?? null) : null,
      };
    });
  }, [tree, positions]);

  return (
    <Tabs
      items={[
        { key: 'persons', label: `Cán bộ (${persons.length})`, children: <PersonsTab persons={persons} positions={rows} /> },
        { key: 'positions', label: `Vị trí việc làm (${rows.length})`, children: <PositionsTab rows={rows} units={tree} persons={persons} /> },
        { key: 'units', label: `Đơn vị (${tree.length})`, children: <UnitsTab units={tree} /> },
      ]}
    />
  );
}
