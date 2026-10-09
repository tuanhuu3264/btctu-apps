'use client';

import { Empty, Select, Space, Table, Tag } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { EvaluationSummary, Period } from '@/lib/api';
import { num } from '@/lib/labels';
import PeriodActions from './period-actions';
import type { Assignee } from './period-actions';

type Row = EvaluationSummary & { fullName: string; positionTitle: string };

interface Props {
  periods: Period[];
  selected: Period | null;
  rows: Row[];
  assignees: Assignee[];
  names: Record<string, string>;
  canManagePeriod: boolean;
  canAssign: boolean;
}

export default function EvaluationsView({ periods, selected, rows, assignees, names, canManagePeriod, canAssign }: Props) {
  const router = useRouter();

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 220 }}
          placeholder="Chọn kỳ đánh giá"
          value={selected?.id}
          options={periods.map((p) => ({ value: p.id, label: `${p.label}${p.status === 'CLOSED' ? ' (đã đóng)' : ''}` }))}
          onChange={(id) => router.push(`/evaluations?period=${id}`)}
          notFoundContent="Chưa có kỳ đánh giá nào"
        />
        {selected && (
          <span>
            {selected.startDate} đến {selected.endDate} {selected.status === 'OPEN' ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng</Tag>}
          </span>
        )}
        <PeriodActions
          periodId={selected?.id ?? null}
          names={names}
          periodOpen={selected?.status === 'OPEN'}
          canManagePeriod={canManagePeriod}
          canAssign={canAssign}
          assignees={assignees}
        />
      </Space>

      {selected ? (
        <Table
          rowKey="id"
          dataSource={rows}
          pagination={rows.length > 20 ? { pageSize: 20 } : false}
          locale={{ emptyText: <Empty description="Chưa có hồ sơ nào trong phạm vi của bạn" /> }}
          columns={[
            { title: 'Họ và tên', dataIndex: 'fullName', render: (n: string, r: Row) => <Link href={`/evaluations/${r.id}`}>{n}</Link> },
            { title: 'Chức vụ', dataIndex: 'positionTitle' },
            { title: 'Trạng thái', dataIndex: 'status', render: (s: EvaluationSummary['status']) => <StatusTag status={s} /> },
            { title: 'Tổng điểm', dataIndex: 'totalScore', align: 'right', render: (n: number | null) => num(n) },
            { title: 'Xếp loại', dataIndex: 'rating', render: (r: EvaluationSummary['rating']) => <RatingTag rating={r} /> },
          ]}
        />
      ) : (
        <Empty description="Chưa có kỳ đánh giá nào" />
      )}
    </Space>
  );
}
