'use client';

import { Alert, Card, Col, Empty, List, Row, Space, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useState } from 'react';
import { HBars } from '@/components/charts';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { AccessReviewView, Deadline, EarlyWarning, MeetingRow, MyMeetingAction, PeriodReport, ProjectWarnings, SearchResult, TaskStatistics } from '@/lib/api';
import { dmyText, hhmmText, meetingTimeText, num } from '@/lib/labels';
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

/**
 * Cảnh báo sớm: việc có nguy cơ chậm (sắp đến hạn mà chưa làm nhiều, hoặc chậm so với tiến độ thời gian), để nhắc kịp thời.
 * Quy tắc đơn giản trên số liệu có sẵn, không đổi điểm; chậm thật vẫn tính khi việc được xác nhận sau hạn.
 */
export function EarlyWarningPanel({ scope, version }: { scope: 'mine' | 'team' | 'all'; version: number }) {
  const { data, error } = useRemote<EarlyWarning>(`/tasking/assignments/early-warning?scope=${scope}`, version);
  if (error) return <Alert type="error" showIcon message={error} />;
  const items = (data?.items ?? []).slice(0, 8);
  return (
    <Card
      size="small"
      title="Cảnh báo sớm"
      extra={data ? <Space size={4}><Tag color="red">{data.high} nguy cơ cao</Tag><Tag color="gold">{data.medium} cần theo dõi</Tag></Space> : null}
    >
      <List
        size="small"
        loading={!data}
        dataSource={items}
        locale={{ emptyText: 'Chưa có việc nào có nguy cơ chậm.' }}
        renderItem={(i) => (
          <List.Item>
            <Link href="/tasks" style={{ flex: 1 }}>
              {i.title}
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {scope !== 'mine' && i.assigneeName ? `${i.assigneeName} · ` : ''}hạn {i.dueDate} · {i.text}
                </Typography.Text>
              </div>
            </Link>
            <Tag color={i.level === 'HIGH' ? 'red' : 'gold'}>{i.level === 'HIGH' ? 'Cao' : 'Theo dõi'}</Tag>
          </List.Item>
        )}
      />
      {data && data.items.length > items.length && (
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          Còn {data.items.length - items.length} cảnh báo khác. <Link href="/tasks">Xem trong Việc được giao</Link>
        </Typography.Paragraph>
      )}
      {scope !== 'mine' && data && data.byAssignee.length > 0 && (
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0', fontSize: 12 }}>
          Cần nhắc: {data.byAssignee.slice(0, 5).map((p) => `${p.name ?? 'cán bộ'} (${p.high + p.medium})`).join(', ')}
        </Typography.Paragraph>
      )}
    </Card>
  );
}

/** Mốc đề án, dự án (ADR-050): mốc quá hạn, sắp đến hạn và đề án quá ngày kết thúc mà chưa nghiệm thu. */
export function ProjectWarningPanel({ scope, version }: { scope: 'mine' | 'team' | 'all'; version: number }) {
  const { data, error } = useRemote<ProjectWarnings>(`/projects/early-warning?scope=${scope}`, version);
  if (error) return <Alert type="error" showIcon message={error} />;
  const items = (data?.items ?? []).slice(0, 8);
  return (
    <Card
      size="small"
      title="Mốc đề án, dự án"
      extra={data ? <Space size={4}><Tag color="red">{data.high} nguy cơ cao</Tag><Tag color="gold">{data.medium} cần theo dõi</Tag></Space> : null}
    >
      <List
        size="small"
        loading={!data}
        dataSource={items}
        locale={{ emptyText: 'Chưa có mốc nào quá hạn hoặc sắp đến hạn.' }}
        renderItem={(i) => (
          <List.Item>
            <Link href={`/projects/${i.projectId}`} style={{ flex: 1 }}>
              <Typography.Text code>{i.projectCode}</Typography.Text> {i.milestoneTitle ?? i.projectTitle}
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {scope !== 'mine' ? `${i.ownerName} · ` : ''}hạn {i.dueDate.split('-').reverse().join('/')} · {i.text}
                </Typography.Text>
              </div>
            </Link>
            <Tag color={i.level === 'HIGH' ? 'red' : 'gold'}>{i.level === 'HIGH' ? 'Cao' : 'Theo dõi'}</Tag>
          </List.Item>
        )}
      />
      {data && data.items.length > items.length && (
        <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
          Còn {data.items.length - items.length} cảnh báo khác. <Link href="/projects">Xem trong Đề án, dự án</Link>
        </Typography.Paragraph>
      )}
    </Card>
  );
}

/** Lịch họp sắp tới trong 7 ngày và việc sau họp còn mở của chính người dùng (ADR-051). */
export function MeetingPanel({ version }: { version: number }) {
  // Khoảng 7 ngày tính một lần khi khối được dựng (đổi ở mỗi lần dựng sẽ làm tải lặp); vào lại trang thì tính lại.
  const [range] = useState(() => {
    const now = Date.now();
    return `from=${encodeURIComponent(new Date(now).toISOString())}&to=${encodeURIComponent(new Date(now + 7 * 86_400_000).toISOString())}`;
  });
  const meetings = useRemote<MeetingRow[]>(`/meetings?${range}&scope=mine`, version);
  const actions = useRemote<MyMeetingAction[]>('/meetings/my-actions', version);
  const error = meetings.error ?? actions.error;
  const upcoming = (meetings.data ?? []).filter((r) => r.meeting.status !== 'CANCELLED');
  const open = actions.data ?? [];

  return (
    <Card size="small" title="Lịch họp sắp tới và việc sau họp" extra={<Link href="/meetings">Xem lịch họp</Link>}>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Typography.Text strong>Họp trong 7 ngày tới ({upcoming.length})</Typography.Text>
          <List
            size="small"
            loading={meetings.loading && meetings.data === null}
            dataSource={upcoming.slice(0, 8)}
            locale={{ emptyText: 'Không có cuộc họp nào trong 7 ngày tới.' }}
            renderItem={(r) => (
              <List.Item>
                <Link href={`/meetings/${r.meeting.id}`} style={{ flex: 1, minWidth: 0 }}>
                  {r.meeting.title}
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {hhmmText(r.meeting.startAt)} {meetingTimeText(r.meeting.startAt).slice(6)}
                      {r.meeting.location ? ` · ${r.meeting.location}` : ''}
                    </Typography.Text>
                  </div>
                </Link>
                {r.myResponse === 'PENDING' && <Tag color="gold">Chưa trả lời</Tag>}
              </List.Item>
            )}
          />
          {upcoming.length > 8 && (
            <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
              Còn {upcoming.length - 8} cuộc họp khác. <Link href="/meetings">Xem lịch họp</Link>
            </Typography.Paragraph>
          )}
        </Col>
        <Col xs={24} md={12}>
          <Typography.Text strong>Việc sau họp còn mở ({open.length})</Typography.Text>
          <List
            size="small"
            loading={actions.loading && actions.data === null}
            dataSource={open.slice(0, 8)}
            locale={{ emptyText: 'Không có việc sau họp nào còn mở.' }}
            renderItem={(a) => (
              <List.Item>
                <Link href={`/meetings/${a.action.meetingId}`} style={{ flex: 1, minWidth: 0 }}>
                  {a.action.content}
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {a.meetingTitle}
                    </Typography.Text>
                  </div>
                </Link>
                <Tag color={a.overdue ? 'red' : 'blue'}>{a.overdue ? 'Quá hạn ' : 'Hạn '}{dmyText(a.action.dueDate)}</Tag>
              </List.Item>
            )}
          />
          {open.length > 8 && (
            <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
              Còn {open.length - 8} việc khác.
            </Typography.Paragraph>
          )}
        </Col>
      </Row>
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
