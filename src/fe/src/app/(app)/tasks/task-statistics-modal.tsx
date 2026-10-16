'use client';

import { Alert, Descriptions, Modal, Spin, Table } from 'antd';
import { useEffect, useState } from 'react';
import type { TaskGroupStats, TaskStatistics } from '@/lib/api';
import { apiGet } from '@/lib/client';
import { STATE_LABELS } from '@/lib/labels';

const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1).replace('.', ',')}%`);

/** Thống kê các việc theo bộ lọc đang chọn: theo trạng thái, tỷ lệ việc chậm và chưa đạt, theo đơn vị (PLAN-A A6.4). Chỉ được dựng khi đang mở. */
export default function TaskStatisticsModal({ query, onClose }: { query: string; onClose: () => void }) {
  const [stats, setStats] = useState<TaskStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<TaskStatistics>(`/tasking/assignments/statistics?${query}`)
      .then((s) => !cancelled && setStats(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [query]);

  const o = stats?.overall;
  return (
    <Modal open title="Thống kê việc theo bộ lọc hiện tại" footer={null} onCancel={onClose} width={860}>
      {error && <Alert type="error" showIcon message={error} />}
      {!stats && !error && <Spin />}
      {stats && o && (
        <>
          <Descriptions
            bordered
            size="small"
            column={2}
            items={[
              ...(Object.keys(STATE_LABELS) as (keyof typeof STATE_LABELS)[]).map((s) => ({ key: s, label: STATE_LABELS[s], children: stats.byState[s] })),
              { key: 'total', label: 'Tổng số việc tính tỷ lệ', children: o.total },
              { key: 'late', label: 'Việc chậm (quá hạn hoặc báo cáo sau hạn)', children: `${o.late} (${pct(o.lateRate)})` },
              { key: 'rework', label: 'Việc có lần chưa đạt', children: `${o.rework} (${pct(o.reworkRate)})` },
            ]}
          />
          <p style={{ color: '#888', margin: '8px 0' }}>Tỷ lệ tính trên việc đang thực hiện, chờ xác nhận, quá hạn và hoàn thành; việc đã hủy và đề xuất chưa duyệt không tính.</p>
          <Table<{ unitName: string } & TaskGroupStats>
            rowKey="unitName"
            size="small"
            pagination={false}
            dataSource={stats.byUnit}
            locale={{ emptyText: 'Chưa có việc nào' }}
            columns={[
              { title: 'Đơn vị', dataIndex: 'unitName' },
              { title: 'Số việc', dataIndex: 'total', align: 'right' },
              { title: 'Hoàn thành', dataIndex: 'done', align: 'right' },
              { title: 'Quá hạn', dataIndex: 'overdue', align: 'right' },
              { title: 'Việc chậm', dataIndex: 'late', align: 'right' },
              { title: 'Tỷ lệ chậm', dataIndex: 'lateRate', align: 'right', render: pct },
              { title: 'Chưa đạt', dataIndex: 'rework', align: 'right' },
              { title: 'Tỷ lệ chưa đạt', dataIndex: 'reworkRate', align: 'right', render: pct },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
