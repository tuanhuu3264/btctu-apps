'use client';

import { Alert, Descriptions, Modal, Spin, Table } from 'antd';
import { useEffect, useState } from 'react';
import type { ProjectStatistics } from '@/lib/api';
import { apiGet } from '@/lib/client';
import { percentText, PROJECT_KIND_LABELS, PROJECT_STATUS_LABELS } from '@/lib/labels';

/** Thống kê đề án, dự án theo bộ lọc đang chọn (GET /projects/statistics). Chỉ được dựng khi đang mở. */
export default function ProjectStatisticsModal({ query, onClose }: { query: string; onClose: () => void }) {
  const [stats, setStats] = useState<ProjectStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<ProjectStatistics>(`/projects/statistics?${query}`)
      .then((s) => !cancelled && setStats(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <Modal open title="Thống kê đề án, dự án theo bộ lọc hiện tại" footer={null} onCancel={onClose} width={820}>
      {error && <Alert type="error" showIcon message={error} />}
      {!stats && !error && <Spin />}
      {stats && (
        <>
          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, md: 2 }}
            items={[
              ...(Object.keys(PROJECT_STATUS_LABELS) as (keyof typeof PROJECT_STATUS_LABELS)[]).map((s) => ({ key: s, label: PROJECT_STATUS_LABELS[s], children: stats.byStatus[s] })),
              ...(Object.keys(PROJECT_KIND_LABELS) as (keyof typeof PROJECT_KIND_LABELS)[]).map((k) => ({ key: k, label: PROJECT_KIND_LABELS[k], children: stats.byKind[k] })),
              { key: 'total', label: 'Tổng số', children: stats.total },
              { key: 'avg', label: 'Đang thực hiện: tiến độ trung bình', children: percentText(stats.active.averageProgress) },
              { key: 'withOverdue', label: 'Đang thực hiện: số đề án có mốc quá hạn', children: stats.active.withOverdueMilestones },
              { key: 'overdue', label: 'Đang thực hiện: tổng số mốc quá hạn', children: stats.active.overdueMilestones },
              { key: 'past', label: 'Đang thực hiện: số đề án quá ngày kết thúc', children: stats.active.pastEndDate },
            ]}
          />
          <p style={{ color: '#888', margin: '8px 0' }}>Tiến độ tính theo trọng số các mốc đã xong; chỉ xét đề án đang thực hiện.</p>
          <Table<ProjectStatistics['byUnit'][number]>
            rowKey="unitName"
            size="small"
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={stats.byUnit}
            locale={{ emptyText: 'Chưa có đề án nào' }}
            columns={[
              { title: 'Đơn vị chủ trì', dataIndex: 'unitName' },
              { title: 'Tổng', dataIndex: 'total', align: 'right' },
              { title: 'Đang thực hiện', dataIndex: 'active', align: 'right' },
              { title: 'Đã nghiệm thu', dataIndex: 'completed', align: 'right' },
            ]}
          />
        </>
      )}
    </Modal>
  );
}
