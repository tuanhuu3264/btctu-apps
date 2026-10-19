'use client';

import { Collapse, Tag, Tree } from 'antd';
import type { TreeDataNode } from 'antd';
import type { OrgPosition, OrgUnit } from '@/lib/api';

/** Dựng cây vị trí của một đơn vị theo quan hệ báo cáo; vị trí gốc là vị trí không có cấp trên trong đơn vị. */
function buildNodes(positions: OrgPosition[]): TreeDataNode[] {
  const ids = new Set(positions.map((p) => p.id));
  const toNode = (p: OrgPosition): TreeDataNode => ({
    key: p.id,
    title: (
      <span>
        <strong>{p.title}</strong>: {p.holder ? p.holder.fullName : <Tag>còn trống</Tag>}
      </span>
    ),
    children: positions.filter((c) => c.reportsToPositionId === p.id).map(toNode),
  });
  return positions.filter((p) => !p.reportsToPositionId || !ids.has(p.reportsToPositionId)).map(toNode);
}

export default function OrgTree({ units }: { units: OrgUnit[] }) {
  return (
    <Collapse
      defaultActiveKey={units.map((u) => u.id)}
      items={units.map((u) => ({
        key: u.id,
        label: (
          <span>
            {u.name} <Tag>{u.code}</Tag>
            <Tag color="blue">{u.positions.length} vị trí</Tag>
          </span>
        ),
        children: u.positions.length === 0 ? 'Chưa có vị trí việc làm.' : <Tree treeData={buildNodes(u.positions)} defaultExpandAll selectable={false} />,
      }))}
    />
  );
}
