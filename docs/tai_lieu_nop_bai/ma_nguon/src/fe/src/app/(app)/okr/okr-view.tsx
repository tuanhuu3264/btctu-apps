'use client';

import { Alert, Card, Empty, Progress, Segmented, Space, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AssignmentView, Okr } from '@/lib/api';
import { summarizeKeyResults } from '@/lib/okr';
import type { KeyResultRow } from '@/lib/okr';

export interface OkrGroup {
  personId: string;
  name: string;
  okr: Okr;
  views: AssignmentView[];
}

const columns = [
  {
    title: 'Kết quả then chốt',
    dataIndex: 'label',
    render: (_: unknown, r: KeyResultRow) =>
      r.label === null ? (
        <Typography.Text type="secondary">Việc chưa gắn kết quả then chốt</Typography.Text>
      ) : (
        <Space size={4} wrap>
          <span>{r.label}</span>
          {r.stale && <Tag color="orange">không còn trong OKR hiện tại</Tag>}
          {r.total === 0 && <Tag>chưa có việc</Tag>}
        </Space>
      ),
  },
  { title: 'Số việc', dataIndex: 'total', width: 80, align: 'right' as const },
  {
    title: 'Hoàn thành',
    width: 160,
    render: (_: unknown, r: KeyResultRow) =>
      r.total === 0 ? '–' : <Progress percent={Math.round((r.done / r.total) * 100)} size="small" format={() => `${r.done}/${r.total}`} />,
  },
  { title: 'Chờ xác nhận', dataIndex: 'pending', width: 110, align: 'right' as const },
  { title: 'Đang làm', dataIndex: 'inProgress', width: 90, align: 'right' as const },
  { title: 'Quá hạn', dataIndex: 'overdue', width: 90, align: 'right' as const, render: (n: number) => (n > 0 ? <Tag color="red">{n}</Tag> : 0) },
  { title: 'Lần chậm', dataIndex: 'late', width: 90, align: 'right' as const },
  { title: 'Lần chưa đạt', dataIndex: 'rework', width: 110, align: 'right' as const },
];

export default function OkrView({ scope, hasTeam, groups }: { scope: 'mine' | 'team'; hasTeam: boolean; groups: OkrGroup[] }) {
  const router = useRouter();
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Theo dõi OKR không tính điểm"
        description="Bảng gom các việc đã giao theo kết quả then chốt của người nhận. Điểm đánh giá vẫn tính theo số lượng, chất lượng, tiến độ của từng việc (Nghị định 335, 05-HD/TU). Gắn việc với kết quả then chốt khi giao việc ở trang Việc được giao."
      />
      {hasTeam && (
        <Segmented
          value={scope}
          options={[
            { value: 'mine', label: 'OKR của tôi' },
            { value: 'team', label: 'OKR của cấp dưới' },
          ]}
          onChange={(v) => router.push(v === 'team' ? '/okr?scope=team' : '/okr')}
        />
      )}
      {groups.length === 0 && <Empty description={scope === 'team' ? 'Cấp dưới chưa được giao việc nào' : 'Chưa có dữ liệu'} />}
      {groups.map((g) => {
        const rows = summarizeKeyResults(g.okr, g.views);
        return (
          <Card key={g.personId} size="small" title={g.name} extra={<Link href="/tasks">Mở việc được giao</Link>}>
            <Space orientation="vertical" size="small" style={{ width: '100%' }}>
              {g.okr.objective ? (
                <Typography.Text>
                  <strong>Mục tiêu:</strong> {g.okr.objective}
                </Typography.Text>
              ) : g.okr.raw === '' ? (
                <Typography.Text type="secondary">Vị trí này chưa có OKR trong sơ đồ phân công.</Typography.Text>
              ) : null}
              {g.okr.keyResults.length === 0 && g.okr.raw !== '' && (
                <Typography.Text type="secondary">Nội dung ghi cho vị trí này là hướng chỉ đạo, không có kết quả then chốt đo được để gắn việc.</Typography.Text>
              )}
              <Table size="small" rowKey="key" pagination={false} columns={columns} dataSource={rows} locale={{ emptyText: 'Chưa có việc nào' }} />
            </Space>
          </Card>
        );
      })}
    </Space>
  );
}
