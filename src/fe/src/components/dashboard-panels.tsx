'use client';

import { Alert, Card, Empty, List, Space, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { HBars } from '@/components/charts';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { AccessReviewView, Deadline, PeriodReport, SearchResult, TaskStatistics } from '@/lib/api';
import { num } from '@/lib/labels';
import { useRemote } from '@/lib/use-remote';

export type DashboardMode = 'BAN' | 'PHONG' | 'CA_NHAN';

export const MODE_TEXT: Record<DashboardMode, { label: string; hint: string }> = {
  BAN: { label: 'Toàn Ban', hint: 'Số liệu của tất cả các phòng thuộc Ban.' },
  PHONG: { label: 'Phòng và cấp dưới', hint: 'Số liệu của bạn và các cán bộ thuộc quyền.' },
  CA_NHAN: { label: 'Cá nhân', hint: 'Số liệu việc và kết quả đánh giá của riêng bạn.' },
};

const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1).replace('.', ',')}%`);
interface AlertRow {
  key: string;
  label: string;
  count: number | null;
  href: string;
  /** warning: cần xử lý; danger: quá hạn, vi phạm thời hạn. */
  tone: 'warning' | 'danger';
  detail?: string;
}

function Rows({ rows }: { rows: AlertRow[] }) {
  return (
    <List
      size="small"
      dataSource={rows}
      locale={{ emptyText: 'Không có mục nào cần xử lý.' }}
      renderItem={(r) => (
        <List.Item>
          <Link href={r.href} style={{ flex: 1 }}>
            {r.label}
            {r.detail && <Typography.Text type="secondary"> – {r.detail}</Typography.Text>}
          </Link>
          <Tag color={r.count === null ? 'default' : r.tone === 'danger' ? 'red' : 'gold'}>{r.count === null ? '…' : r.count}</Tag>
        </List.Item>
      )}
    />
  );
}

/** "Cần xử lý": các mục cần hành động hoặc đã quá hạn, mỗi mục dẫn tới màn xử lý (PLAN-A A7). Khối nào không đủ quyền thì không tải. */
export function AttentionPanel({
  version,
  report,
  deadline,
  canTeam,
  canReviews,
}: {
  version: number;
  report: PeriodReport | null;
  deadline: Deadline | null;
  canTeam: boolean;
  canReviews: boolean;
}) {
  const proposals = useRemote<SearchResult>(canTeam ? '/tasking/assignments/search?scope=team&states=PROPOSED&pageSize=1' : null, version);
  const overdue = useRemote<SearchResult>(canTeam ? '/tasking/assignments/search?scope=team&states=OVERDUE&pageSize=1' : null, version);
  const reviews = useRemote<AccessReviewView[]>(canReviews ? '/access-reviews' : null, version);

  const o = report?.overall;
  const periodHref = report ? `/evaluations?period=${report.period.id}` : '/evaluations';
  const open = (reviews.data ?? []).filter((r) => r.status === 'OPEN');
  const rows: AlertRow[] = [
    ...(o ? [{ key: 'approve', label: 'Hồ sơ đánh giá chờ phê duyệt', count: o.pendingApproval, href: periodHref, tone: 'warning' as const }] : []),
    ...(o ? [{ key: 'progress', label: 'Hồ sơ chưa xong (chưa tự chấm hoặc chờ thẩm định)', count: o.inProgress, href: periodHref, tone: 'warning' as const }] : []),
    ...(deadline && report
      ? [{ key: 'deadline', label: `Hạn hoàn thành đánh giá năm ${report.period.label}`, count: deadline.overdue ? 1 : deadline.reminder ? 1 : 0, href: periodHref, tone: deadline.overdue ? ('danger' as const) : ('warning' as const), detail: deadline.overdue ? `đã quá hạn ${Math.abs(deadline.daysLeft)} ngày` : `còn ${deadline.daysLeft} ngày (hạn ${deadline.date})` }]
      : []),
    ...(canTeam
      ? [
          { key: 'proposal', label: 'Đề xuất việc đột xuất chờ bạn duyệt', count: proposals.data?.total ?? null, href: '/tasks', tone: 'warning' as const },
          { key: 'team-overdue', label: 'Việc quá hạn của cấp dưới', count: overdue.data?.total ?? null, href: '/tasks', tone: 'danger' as const },
        ]
      : []),
    ...(canReviews
      ? [
          { key: 'review-pending', label: 'Quyền chưa được xem xét trong các đợt rà soát đang mở', count: reviews.data ? open.reduce((n, r) => n + r.counts.pending, 0) : null, href: '/access-reviews', tone: 'warning' as const },
          { key: 'review-overdue', label: 'Đợt rà soát quyền quá hạn', count: reviews.data ? open.filter((r) => r.overdue).length : null, href: '/access-reviews', tone: 'danger' as const },
        ]
      : []),
  ];
  return (
    <Card size="small" title="Cần xử lý">
      <Rows rows={rows.filter((r) => r.count === null || r.count > 0)} />
    </Card>
  );
}

/** Tỷ lệ việc chậm theo đơn vị, từ thống kê việc trong phạm vi của người xem. */
export function UnitLatePanel({ scope, version }: { scope: 'all' | 'team'; version: number }) {
  const { data, error } = useRemote<TaskStatistics>(`/tasking/assignments/statistics?scope=${scope}`, version);
  if (error) return <Alert type="error" showIcon message={error} />;
  const units = (data?.byUnit ?? []).filter((u) => u.total > 0);
  return (
    <div>
      <Typography.Text strong>Tỷ lệ việc chậm theo đơn vị (càng thấp càng tốt)</Typography.Text>
      <div style={{ marginTop: 8 }}>
        {units.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có việc." />
        ) : (
          <HBars max={100} rows={units.map((u) => ({ label: u.unitName, value: u.lateRate === null ? null : u.lateRate * 100, text: pct(u.lateRate), hint: `${u.late}/${u.total} việc chậm, ${u.rework} việc có lần chưa đạt` }))} />
        )}
      </div>
    </div>
  );
}

/** Kết quả đánh giá của chính người dùng trong kỳ; cán bộ kiêm nhiệm có một dòng cho mỗi vị trí. */
export function MyResultsPanel({ report, myPersonId }: { report: PeriodReport | null; myPersonId: string | null }) {
  const mine = (report?.rows ?? []).filter((r) => myPersonId && r.personId === myPersonId);
  return (
    <Card size="small" title="Kết quả của tôi trong kỳ" extra={report ? <Link href="/evaluations">Hồ sơ đánh giá</Link> : null}>
      {mine.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={report ? 'Bạn chưa có hồ sơ đánh giá trong kỳ này.' : 'Chưa có kỳ đánh giá nào.'} />
      ) : (
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Table
            size="small"
            pagination={false}
            rowKey="evaluationId"
            dataSource={mine}
            columns={[
              { title: 'Vị trí', dataIndex: 'positionTitle' },
              { title: 'Đơn vị', dataIndex: 'unitName' },
              { title: 'Trạng thái', dataIndex: 'status', render: (s) => <StatusTag status={s} /> },
              { title: 'Tổng điểm', dataIndex: 'totalScore', align: 'right', render: (n: number | null) => num(n) },
              { title: 'Xếp loại', dataIndex: 'rating', render: (r) => <RatingTag rating={r} /> },
            ]}
          />
          {mine.length > 1 && <Alert type="info" showIcon message="Bạn kiêm nhiệm nhiều vị trí: mỗi vị trí có phiếu và điểm riêng, không gộp." />}
        </Space>
      )}
    </Card>
  );
}
