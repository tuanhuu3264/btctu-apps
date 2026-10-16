'use client';

import { SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Select, Space, Table, Tag } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DeadlinePanel from '@/components/deadline-panel';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { Period, UnitEvaluationView } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { num } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

type Row = UnitEvaluationView & { headName: string };

interface Props {
  periods: Period[];
  selected: Period | null;
  rows: Row[];
  canManagePeriod: boolean;
}

export default function UnitEvaluationsView({ periods, selected, rows, canManagePeriod }: Props) {
  const router = useRouter();
  const { run, busy } = useAction();

  async function generate() {
    if (!selected) return;
    await run(
      async () => void (await apiCall('POST', `/unit-evaluation/periods/${selected.id}/generate`)),
      { success: 'Đã tạo hồ sơ cho các đơn vị còn thiếu' },
    );
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Xếp loại tập thể chỉ theo năm. Điểm tập thể được chấm riêng (tiêu chí chung 30, kết quả nhiệm vụ 70), không suy từ điểm cá nhân (Nghị định 335/2025/NĐ-CP, Điều 5–9). Đơn vị cấp dưới được phê duyệt trước đơn vị cấp trên."
      />
      <Space wrap>
        <Select
          style={{ width: 220 }}
          placeholder="Chọn kỳ năm"
          value={selected?.id}
          options={periods.map((p) => ({ value: p.id, label: `Năm ${p.label}${p.status === 'CLOSED' ? ' (đã đóng)' : ''}` }))}
          onChange={(id) => router.push(`/unit-evaluations?period=${id}`)}
          notFoundContent="Chưa có kỳ năm nào (tạo ở trang Đánh giá theo kỳ)"
        />
        {selected && (selected.status === 'OPEN' ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng</Tag>)}
        {canManagePeriod && (
          <Link href="/unit-evaluations/axes">
            <Button icon={<SettingOutlined />}>Cấu hình trục chấm điểm</Button>
          </Link>
        )}
        {canManagePeriod && selected?.status === 'OPEN' && (
          <Button icon={<SyncOutlined />} loading={busy} onClick={generate}>
            Tạo hồ sơ cho các đơn vị
          </Button>
        )}
      </Space>

      {selected && <DeadlinePanel period={selected} canManage={canManagePeriod} scope="tập thể" />}

      {selected ? (
        <Table
          rowKey={(r) => r.evaluation.id}
          dataSource={rows}
          pagination={rows.length > 20 ? { pageSize: 20 } : false}
          locale={{ emptyText: <Empty description="Chưa có hồ sơ nào trong phạm vi của bạn" /> }}
          columns={[
            {
              title: 'Đơn vị',
              render: (_: unknown, r: Row) => (
                <Link href={`/unit-evaluations/${r.evaluation.id}`}>
                  {r.unit.name} {r.unit.type === 'BAN' && <Tag>Ban</Tag>}
                </Link>
              ),
            },
            { title: 'Người đứng đầu', dataIndex: 'headName' },
            { title: 'Trạng thái', render: (_: unknown, r: Row) => <StatusTag status={r.evaluation.status} /> },
            { title: 'Tổng điểm', align: 'right', render: (_: unknown, r: Row) => num(r.evaluation.totalScore) },
            { title: 'Xếp loại', render: (_: unknown, r: Row) => <RatingTag rating={r.evaluation.rating} /> },
            {
              title: 'Cảnh báo',
              align: 'right',
              render: (_: unknown, r: Row) => (r.warnings.length > 0 ? <Tag color="orange">{r.warnings.length}</Tag> : '–'),
            },
          ]}
        />
      ) : (
        <Empty description="Chưa có kỳ năm nào" />
      )}
    </Space>
  );
}
