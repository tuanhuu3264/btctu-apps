'use client';

import { Empty, Input, Select, Space, Table, Tag } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import DeadlinePanel from '@/components/deadline-panel';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { EvaluationSummary, Period } from '@/lib/api';
import { foldText, num, STATUS_LABELS } from '@/lib/labels';
import PeriodActions from './period-actions';
import type { Assignee } from './period-actions';

type Row = EvaluationSummary & { fullName: string; positionTitle: string; concurrent: boolean };

interface Props {
  periods: Period[];
  selected: Period | null;
  rows: Row[];
  assignees: Assignee[];
  names: Record<string, string>;
  canManagePeriod: boolean;
  canAssign: boolean;
  unitNames: Record<string, string>;
  canReadAll: boolean;
}

export default function EvaluationsView({ periods, selected, rows, assignees, names, canManagePeriod, canAssign, unitNames, canReadAll }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EvaluationSummary['status'] | undefined>(undefined);
  const [rating, setRating] = useState<NonNullable<EvaluationSummary['rating']> | 'NONE' | undefined>(undefined);
  const shown = useMemo(() => {
    const needle = foldText(search);
    return rows.filter(
      (r) =>
        (!needle || foldText(`${r.fullName} ${r.positionTitle}`).includes(needle)) &&
        (!status || r.status === status) &&
        (!rating || (rating === 'NONE' ? r.rating === null : r.rating === rating)),
    );
  }, [rows, search, status, rating]);

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
          unitNames={unitNames}
          canReadAll={canReadAll}
        />
      </Space>

      {selected && <DeadlinePanel period={selected} canManage={canManagePeriod} scope="cá nhân" />}

      {selected && (
        <Space wrap>
          <Input.Search allowClear placeholder="Tìm theo họ tên, chức vụ (không cần dấu)" style={{ width: 320 }} onChange={(e) => setSearch(e.target.value)} />
          <Select allowClear placeholder="Trạng thái" style={{ width: 220 }} value={status} onChange={setStatus} options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          <Select
            allowClear
            placeholder="Xếp loại"
            style={{ width: 200 }}
            value={rating}
            onChange={setRating}
            options={[
              { value: 'XUAT_SAC', label: 'Hoàn thành xuất sắc' },
              { value: 'HOAN_THANH_TOT', label: 'Hoàn thành tốt' },
              { value: 'HOAN_THANH', label: 'Hoàn thành' },
              { value: 'KHONG_HOAN_THANH', label: 'Không hoàn thành' },
              { value: 'NONE', label: 'Chưa xếp loại' },
            ]}
          />
          <span style={{ color: '#888' }}>{shown.length === rows.length ? `${rows.length} hồ sơ` : `${shown.length} / ${rows.length} hồ sơ`}</span>
        </Space>
      )}

      {selected ? (
        <Table
          rowKey="id"
          dataSource={shown}
          pagination={shown.length > 20 ? { pageSize: 20 } : false}
          locale={{ emptyText: <Empty description="Chưa có hồ sơ nào trong phạm vi của bạn" /> }}
          columns={[
            { title: 'Họ và tên', dataIndex: 'fullName', render: (n: string, r: Row) => <Link href={`/evaluations/${r.id}`}>{n}</Link> },
            { title: 'Chức vụ', dataIndex: 'positionTitle', render: (t: string, r: Row) => (<>{t} {r.concurrent && <Tag color="purple">Kiêm nhiệm</Tag>}</>) },
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
