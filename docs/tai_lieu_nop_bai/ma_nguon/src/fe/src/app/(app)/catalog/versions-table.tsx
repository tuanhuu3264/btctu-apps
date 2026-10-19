'use client';

import { Table, Tag } from 'antd';
import Link from 'next/link';
import type { CatalogVersion } from '@/lib/api';
import { dateText } from '@/lib/labels';

export default function VersionsTable({ versions }: { versions: CatalogVersion[] }) {
  return (
    <Table
      rowKey="id"
      dataSource={versions}
      pagination={false}
      locale={{ emptyText: 'Chưa có phiên bản danh mục nào. Nhập từ tệp Excel bằng lệnh import-catalog (xem README) hoặc tạo bản nháp trống.' }}
      columns={[
        { title: 'Tên danh mục', dataIndex: 'name', render: (name: string, v) => <Link href={`/catalog/${v.id}`}>{name}</Link> },
        { title: 'Nhãn phiên bản', dataIndex: 'label' },
        {
          title: 'Trạng thái',
          dataIndex: 'status',
          render: (s: CatalogVersion['status']) => (s === 'APPROVED' ? <Tag color="green">Đã phê duyệt</Tag> : <Tag color="gold">Bản nháp</Tag>),
        },
        { title: 'Công việc chuẩn', dataIndex: 'baselineItemCode', render: (c: string | null) => c ?? '–' },
        { title: 'Hiệu lực từ', dataIndex: 'effectiveFrom', render: (d: string | null) => dateText(d) },
      ]}
    />
  );
}
