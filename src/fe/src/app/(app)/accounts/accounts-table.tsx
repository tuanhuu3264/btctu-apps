'use client';

import { Table, Tag } from 'antd';
import Link from 'next/link';
import type { AccountSummary } from '@/lib/api';

type Row = AccountSummary & { personName: string | null };

export default function AccountsTable({ rows }: { rows: Row[] }) {
  return (
    <Table
      rowKey="id"
      dataSource={rows}
      pagination={false}
      columns={[
        { title: 'Tên đăng nhập', dataIndex: 'username', render: (u: string, r) => <Link href={`/accounts/${r.id}`}>{u}</Link> },
        {
          title: 'Trạng thái',
          dataIndex: 'status',
          render: (s: Row['status']) => (s === 'ACTIVE' ? <Tag color="green">Đang hoạt động</Tag> : <Tag color="red">Đã khóa</Tag>),
        },
        { title: 'Cán bộ', dataIndex: 'personName', render: (n: string | null) => n ?? <Tag>chưa gắn</Tag> },
      ]}
    />
  );
}
