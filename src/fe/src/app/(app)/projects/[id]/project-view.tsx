'use client';

import { Alert, Card, Descriptions, Progress, Space, Steps, Tag, Typography } from 'antd';
import type { ProjectDetail } from '@/lib/api';
import { dateTimeText, dmyText, percentText, PROJECT_KIND_LABELS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABELS } from '@/lib/labels';

const FLOW = ['DRAFT', 'SUBMITTED', 'ACTIVE', 'COMPLETED'] as const;

/** Thông tin chung, các bước trạng thái và tiến độ của một đề án, dự án. */
export default function ProjectView({ detail }: { detail: ProjectDetail }) {
  const { project: p, progress } = detail;
  const cancelled = p.status === 'CANCELLED';
  // Hủy thì dừng ở bước đã đến được trước khi hủy.
  const current = cancelled ? (p.approvedAt ? 2 : p.submittedAt ? 1 : 0) : FLOW.indexOf(p.status as (typeof FLOW)[number]);
  const pct = progress.ratio === null ? null : Math.round(progress.ratio * 100);

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%', marginBottom: 16 }}>
      {p.status === 'DRAFT' && p.returnReason && <Alert type="warning" showIcon message="Hồ sơ bị trả lại" description={`Lý do: ${p.returnReason}`} />}
      {p.status === 'COMPLETED' && (
        <Alert type="success" showIcon message={`Đã nghiệm thu ngày ${dmyText(p.completedOn)}`} description={p.closeNote ? `Nhận xét: ${p.closeNote}` : undefined} />
      )}
      {cancelled && <Alert type="error" showIcon message="Đã hủy" description={p.closeNote ? `Lý do: ${p.closeNote}` : undefined} />}

      <Card size="small">
        <Steps
          size="small"
          current={current}
          status={cancelled ? 'error' : undefined}
          items={FLOW.map((s) => ({ title: PROJECT_STATUS_LABELS[s] }))}
          style={{ marginBottom: 8 }}
        />
      </Card>

      <Card size="small" title="Thông tin chung" extra={<Tag color={PROJECT_STATUS_COLORS[p.status]}>{PROJECT_STATUS_LABELS[p.status]}</Tag>}>
        <Descriptions
          size="small"
          bordered
          column={{ xs: 1, md: 2 }}
          items={[
            { key: 'code', label: 'Mã', children: <Typography.Text code>{p.code}</Typography.Text> },
            { key: 'kind', label: 'Loại', children: PROJECT_KIND_LABELS[p.kind] },
            { key: 'owner', label: 'Chủ trì', children: detail.ownerName },
            { key: 'unit', label: 'Đơn vị', children: detail.unitName },
            { key: 'time', label: 'Thời gian thực hiện', children: `${dmyText(p.startDate)} – ${dmyText(p.endDate)}` },
            { key: 'approved', label: 'Phê duyệt lúc', children: dateTimeText(p.approvedAt) },
            { key: 'objective', label: 'Mục tiêu', span: 'filled', children: <span style={{ whiteSpace: 'pre-wrap' }}>{p.objective ?? '–'}</span> },
            { key: 'description', label: 'Nội dung', span: 'filled', children: <span style={{ whiteSpace: 'pre-wrap' }}>{p.description ?? '–'}</span> },
          ]}
        />
      </Card>

      <Card size="small" title="Tiến độ">
        {pct === null ? (
          <Typography.Text type="secondary">Chưa có mốc tiến độ nào.</Typography.Text>
        ) : (
          <Progress percent={pct} status={cancelled ? 'exception' : undefined} />
        )}
        <Typography.Text type="secondary">
          Tiến độ {percentText(progress.ratio)} theo trọng số · {progress.done}/{progress.total} mốc đã xong
          {progress.overdue > 0 && <Typography.Text type="danger"> · {progress.overdue} mốc quá hạn</Typography.Text>}
          {progress.nextDue && ` · mốc gần nhất hạn ${dmyText(progress.nextDue)}`}
        </Typography.Text>
      </Card>
    </Space>
  );
}
