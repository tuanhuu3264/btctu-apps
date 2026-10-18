'use client';

import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Empty, List, Row, Select, Space, Statistic, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Donut, HBars, LineChart, StackBar } from '@/components/charts';
import type { Segment } from '@/components/charts';
import { AttentionPanel, EarlyWarningPanel, MeetingPanel, MODE_TEXT, ProjectWarningPanel, MyResultsPanel, UnitLatePanel } from '@/components/dashboard-panels';
import type { DashboardMode } from '@/components/dashboard-panels';
import type { AssignmentState, Deadline, Period, PeriodReport, SearchResult, Trend } from '@/lib/api';
import { dateText, num, STATE_COLORS, STATE_LABELS } from '@/lib/labels';
import { useRemote } from '@/lib/use-remote';

const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1).replace('.', ',')}%`);

const RATING_SEGMENTS = [
  { key: 'XUAT_SAC', label: 'Xuất sắc', color: '#2e9e5b' },
  { key: 'HOAN_THANH_TOT', label: 'Hoàn thành tốt', color: '#8bc34a' },
  { key: 'HOAN_THANH', label: 'Hoàn thành', color: '#f5b800' },
  { key: 'KHONG_HOAN_THANH', label: 'Không hoàn thành', color: '#c8102e' },
] as const;

const TYPE_LABELS: Record<string, string> = { MONTH: 'tháng', QUARTER: 'quý', YEAR: 'năm' };
const COUNT_STATES: AssignmentState[] = ['IN_PROGRESS', 'PENDING_CONFIRM', 'OVERDUE', 'DONE'];

const search = (scope: string, extra = '') => `/tasking/assignments/search?scope=${scope}&pageSize=5&sort=due${extra}`;

/** Khối công việc của tôi: số việc theo trạng thái, việc quá hạn, việc chờ tôi xác nhận (ADR-027 mục 2). */
function TasksPanel({ version }: { version: number }) {
  const counts = useRemote<SearchResult>(search('mine'), version);
  const overdue = useRemote<SearchResult>(search('mine', '&states=OVERDUE'), version);
  const waiting = useRemote<SearchResult>(search('approving', '&states=PENDING_CONFIRM'), version);
  const error = counts.error ?? overdue.error ?? waiting.error;
  const loading = counts.loading || overdue.loading || waiting.loading;

  const row = (v: SearchResult['items'][number]) => (
    <List.Item key={v.assignment.id}>
      <Link href={`/tasks?open=${v.assignment.id}`} style={{ flex: 1, minWidth: 0 }}>
        <Typography.Text ellipsis style={{ display: 'block', color: 'inherit' }}>
          {v.task.title || v.itemName}
        </Typography.Text>
      </Link>
      <Tag color={STATE_COLORS[v.state]}>hạn {dateText(v.assignment.dueDate)}</Tag>
    </List.Item>
  );

  return (
    <Card
      size="small"
      title="Công việc của tôi"
      extra={
        <Space>
          {loading && <Typography.Text type="secondary">Đang cập nhật…</Typography.Text>}
          <Link href="/tasks">Xem tất cả</Link>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Row gutter={[12, 12]}>
        {COUNT_STATES.map((s) => (
          <Col key={s} xs={12} md={6}>
            <Statistic title={STATE_LABELS[s]} value={counts.data?.stateCounts[s] ?? 0} styles={{ content: { color: s === 'OVERDUE' && (counts.data?.stateCounts[s] ?? 0) > 0 ? '#c8102e' : undefined } }} />
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={12}>
          <Typography.Text strong>Việc quá hạn ({overdue.data?.total ?? 0})</Typography.Text>
          <List size="small" loading={overdue.loading} dataSource={overdue.data?.items ?? []} locale={{ emptyText: 'Không có việc quá hạn' }} renderItem={row} />
        </Col>
        <Col xs={24} md={12}>
          <Typography.Text strong>Chờ tôi xác nhận ({waiting.data?.total ?? 0})</Typography.Text>
          <List size="small" loading={waiting.loading} dataSource={waiting.data?.items ?? []} locale={{ emptyText: 'Không có việc chờ xác nhận' }} renderItem={row} />
        </Col>
      </Row>
    </Card>
  );
}

/** Xu hướng điểm trung bình và tỷ lệ hoàn tất qua các kỳ cùng loại. */
function TrendPanel({ type, version }: { type: string; version: number }) {
  const { data, error, loading } = useRemote<Trend>(`/reporting/trend?type=${type}&limit=8`, version);
  if (error) return <Alert type="error" showIcon message={error} />;
  const points = data?.points ?? [];
  return (
    <Card size="small" title={`Xu hướng qua các ${TYPE_LABELS[type] ?? 'kỳ'} gần nhất`} loading={loading && data === null}>
      {points.length < 2 ? (
        <Empty description="Cần ít nhất hai kỳ cùng loại để vẽ xu hướng." />
      ) : (
        <Row gutter={[24, 16]}>
          <Col xs={24} lg={12}>
            <Typography.Text strong>Điểm trung bình (hồ sơ đã phê duyệt)</Typography.Text>
            <LineChart points={points.map((p) => ({ label: p.period.label, value: p.averageTotal }))} max={100} format={(n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))} />
          </Col>
          <Col xs={24} lg={12}>
            <Typography.Text strong>Tỷ lệ hồ sơ hoàn tất</Typography.Text>
            <LineChart color="#2e9e5b" points={points.map((p) => ({ label: p.period.label, value: p.completionRate === null ? null : p.completionRate * 100 }))} max={100} format={(n) => `${Math.round(n)}%`} />
          </Col>
        </Row>
      )}
      {data?.scope === 'LIMITED' && <Alert style={{ marginTop: 8 }} type="info" showIcon message="Số liệu chỉ gồm hồ sơ trong phạm vi của bạn, không phải toàn Ban." />}
    </Card>
  );
}

function ResultsPanel({ periods, report, mode, canReadAllTasks, canTasks, version }: { periods: Period[]; report: PeriodReport | null; mode: DashboardMode; canReadAllTasks: boolean; canTasks: boolean; version: number }) {
  const router = useRouter();
  const o = report?.overall;
  const ratings: Segment[] = RATING_SEGMENTS.map((r) => ({ label: r.label, color: r.color, value: o?.ratings[r.key] ?? 0 }));
  const units = (report?.byUnit ?? []).filter((u) => u.evaluations > 0);

  return (
    <Card
      size="small"
      title="Kết quả đánh giá"
      extra={
        <Space>
          <Select
            size="small"
            style={{ width: 160 }}
            placeholder="Chọn kỳ"
            value={report?.period.id}
            options={periods.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(id) => router.push(`/?period=${id}`)}
            notFoundContent="Chưa có kỳ đánh giá nào"
          />
          <Link href="/reports">Báo cáo chi tiết</Link>
        </Space>
      }
    >
      {!report || !o ? (
        <Empty description="Chưa có kỳ đánh giá nào." />
      ) : (
        <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          {report.scope === 'LIMITED' && <Alert type="info" showIcon message="Số liệu chỉ gồm hồ sơ trong phạm vi của bạn, không phải toàn Ban." />}
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Statistic title="Hồ sơ trong kỳ" value={o.evaluations} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="Tỷ lệ hoàn tất" value={pct(o.completionRate)} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="Điểm trung bình" value={num(o.averageTotal)} suffix={o.averageTotal === null ? '' : '/100'} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="Chờ phê duyệt" value={o.pendingApproval} styles={{ content: { color: o.pendingApproval > 0 ? '#b8860b' : undefined } }} />
            </Col>
          </Row>
          {mode !== 'CA_NHAN' && (
          <Row gutter={[24, 16]}>
            <Col xs={24} lg={12}>
              <Typography.Text strong>Phân bố xếp loại (đã phê duyệt)</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Donut segments={ratings} centre={String(o.approved)} caption="đã phê duyệt" />
              </div>
              {o.excellentQuota.exceeded && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={`Số xuất sắc (${o.excellentQuota.excellent}) vượt mức tham khảo ${o.excellentQuota.allowed} (39-QĐ/TU Điều 11).`} />}
            </Col>
            <Col xs={24} lg={12}>
              <Typography.Text strong>Tiến độ hồ sơ</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <StackBar
                  segments={[
                    { label: 'Đã phê duyệt', value: o.approved, color: '#2e9e5b' },
                    { label: 'Chờ phê duyệt', value: o.pendingApproval, color: '#f5b800' },
                    { label: 'Đang thực hiện', value: o.inProgress, color: '#bfbfbf' },
                  ]}
                />
              </div>
            </Col>
          </Row>
          )}
          {mode !== 'CA_NHAN' && (
          <>
          <div>
            <Typography.Text strong>Điểm trung bình theo đơn vị</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {units.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có hồ sơ." />
              ) : (
                <HBars
                  max={100}
                  rows={units.map((u) => ({
                    label: u.unitName,
                    value: u.averageTotal,
                    text: num(u.averageTotal),
                    hint: `${u.approved}/${u.evaluations} hồ sơ đã phê duyệt`,
                  }))}
                />
              )}
            </div>
          </div>
          <div>
            <Typography.Text strong>Tỷ lệ hồ sơ hoàn tất theo đơn vị</Typography.Text>
            <div style={{ marginTop: 8 }}>
              {units.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có hồ sơ." />
              ) : (
                <HBars
                  max={100}
                  rows={units.map((u) => ({
                    label: u.unitName,
                    value: u.completionRate === null ? null : u.completionRate * 100,
                    text: pct(u.completionRate),
                    hint: `${u.approved}/${u.evaluations} hồ sơ đã phê duyệt`,
                  }))}
                />
              )}
            </div>
          </div>
          {canTasks && <UnitLatePanel scope={canReadAllTasks ? 'all' : 'team'} version={version} />}
          </>
          )}
        </Space>
      )}
    </Card>
  );
}

interface Props {
  canTasks: boolean;
  canProjects: boolean;
  canMeetings: boolean;
  canReadAllProjects: boolean;
  canReadAllTasks: boolean;
  canReviews: boolean;
  mode: DashboardMode;
  myPersonId: string | null;
  deadline: Deadline | null;
  periods: Period[];
  report: PeriodReport | null;
}

const REFRESH_MS = 60_000;
const timeText = (d: Date) => d.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Trang Tổng quan (ADR-027): mỗi khối chỉ hiện khi người dùng có quyền tương ứng. Tự làm mới mỗi phút khi tab đang mở
 * và ngay khi người dùng quay lại tab; có nút "Tải lại" để làm mới tay.
 */
export default function DashboardView({ canTasks, canProjects, canMeetings, canReadAllProjects, canReadAllTasks, canReviews, mode, myPersonId, deadline, periods, report }: Props) {
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      setVersion((n) => n + 1);
      setUpdatedAt(new Date());
      router.refresh(); // dựng lại phần số liệu do máy chủ lấy (kết quả đánh giá)
    };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router]);

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Typography.Text type="secondary">{updatedAt ? `Cập nhật lúc ${timeText(updatedAt)}` : 'Tự làm mới mỗi phút'}</Typography.Text>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            setVersion((n) => n + 1);
            setUpdatedAt(new Date());
            router.refresh();
          }}
        >
          Tải lại
        </Button>
      </Space>
      <Space wrap>
        <Tag color="red">Góc nhìn: {MODE_TEXT[mode].label}</Tag>
        <Typography.Text type="secondary">{MODE_TEXT[mode].hint}</Typography.Text>
      </Space>
      <AttentionPanel version={version} report={report} deadline={deadline} canTeam={mode !== 'CA_NHAN' && canTasks} canReviews={canReviews} />
      {canTasks && <EarlyWarningPanel scope={mode === 'CA_NHAN' ? 'mine' : canReadAllTasks ? 'all' : 'team'} version={version} />}
      {canProjects && <ProjectWarningPanel scope={mode === 'CA_NHAN' ? 'mine' : canReadAllProjects ? 'all' : 'team'} version={version} />}
      {canMeetings && <MeetingPanel version={version} />}
      {canTasks && <TasksPanel version={version} />}
      {mode === 'CA_NHAN' && <MyResultsPanel report={report} myPersonId={myPersonId} />}
      {(report || periods.length > 0) && <ResultsPanel periods={periods} report={report} mode={mode} canReadAllTasks={canReadAllTasks} canTasks={canTasks} version={version} />}
      {report && mode !== 'CA_NHAN' && <TrendPanel type={report.period.type} version={version} />}
    </Space>
  );
}
