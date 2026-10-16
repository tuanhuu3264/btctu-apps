'use client';

import { DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Collapse, Empty, Progress, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { AxisSummary, Draft, Period, UnitReport, UnitReportRow } from '@/lib/api';
import { num, RATING_LABELS } from '@/lib/labels';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const RATINGS = ['XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH', 'KHONG_HOAN_THANH'] as const;

interface Props {
  periods: Period[];
  report: UnitReport | null;
  draft: Draft | null;
  canExport: boolean;
}

export default function UnitReportView({ periods, report, draft, canExport }: Props) {
  const router = useRouter();

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 220 }}
          placeholder="Chọn kỳ năm"
          value={report?.period.id}
          options={periods.map((p) => ({ value: p.id, label: `Năm ${p.label}` }))}
          onChange={(id) => router.push(`/reports/units?period=${id}`)}
          notFoundContent="Chưa có kỳ năm nào"
        />
        {report && (
          <>
            <span>
              {report.period.startDate} đến {report.period.endDate} {report.period.status === 'OPEN' ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng</Tag>}
            </span>
            {canExport && (
              <Button icon={<DownloadOutlined />} href={`${API_URL}/reporting/periods/${report.period.id}/units/export`}>
                Excel
              </Button>
            )}
          </>
        )}
      </Space>

      {!report ? (
        <Empty description="Chưa có kỳ năm nào" />
      ) : (
        <>
          {report.scope === 'LIMITED' && <Alert type="info" showIcon message="Chỉ gồm các hồ sơ trong phạm vi của bạn, không phải toàn bộ kỳ." />}
          {report.quota.exceeded && (
            <Alert
              type="warning"
              showIcon
              message={`Số tập thể "Hoàn thành xuất sắc" (${report.quota.excellent}) vượt hạn mức 20% số tập thể hoàn thành tốt (${report.quota.good}). Chỉ để tham khảo, hệ thống không tự đổi xếp loại.`}
            />
          )}

          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Tổng số tập thể" value={report.units} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Đã phê duyệt" value={report.approved} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Chờ phê duyệt / đang thực hiện" value={`${report.pendingApproval} / ${report.inProgress}`} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Điểm trung bình" value={num(report.averageTotal)} /></Card></Col>
          </Row>

          <Card size="small" title="Phân bố xếp loại (đã phê duyệt)">
            <Row gutter={[16, 16]}>
              {RATINGS.map((r) => (
                <Col xs={12} md={6} key={r}>
                  <Statistic title={RATING_LABELS[r]} value={report.ratings[r]} />
                </Col>
              ))}
            </Row>
          </Card>

          {report.axisSummary.length > 0 && (
            <Card size="small" title="Điểm theo trục (hồ sơ đã phê duyệt, chấm theo trục)" extra={<Typography.Text type="secondary">Trục có tỷ lệ thấp là nơi cần cải thiện</Typography.Text>}>
              <Table<AxisSummary>
                rowKey="code"
                size="small"
                pagination={false}
                dataSource={report.axisSummary}
                scroll={{ x: 640 }}
                columns={[
                  { title: 'Mã', dataIndex: 'code', width: 70 },
                  { title: 'Trục', render: (_: unknown, a) => <>{a.name} <Tag color={a.kind === 'GENERAL' ? 'default' : 'geekblue'}>{a.kind === 'GENERAL' ? 'Chung' : 'Kết quả'}</Tag></> },
                  { title: 'Tối đa', dataIndex: 'maxPoints', align: 'right', width: 80 },
                  { title: 'Số hồ sơ', dataIndex: 'count', align: 'right', width: 90 },
                  { title: 'Trung bình', align: 'right', width: 100, render: (_: unknown, a) => num(a.average) },
                  { title: 'Thấp nhất', align: 'right', width: 100, render: (_: unknown, a) => num(a.lowest) },
                  { title: 'Tỷ lệ', width: 180, render: (_: unknown, a) => <Progress percent={Math.round((a.ratio ?? 0) * 100)} size="small" status={(a.ratio ?? 1) < 0.5 ? 'exception' : 'normal'} /> },
                ]}
              />
            </Card>
          )}

          <Card size="small" title="Chi tiết từng tập thể">
            <Table<UnitReportRow>
              rowKey="evaluationId"
              size="small"
              pagination={false}
              dataSource={report.rows}
              locale={{ emptyText: <Empty description="Chưa có hồ sơ nào trong phạm vi của bạn" /> }}
              scroll={{ x: 900 }}
              columns={[
                {
                  title: 'Tập thể',
                  render: (_: unknown, r) => (
                    <Link href={`/unit-evaluations/${r.evaluationId}`}>
                      {r.unitName} {r.unitType === 'BAN' && <Tag>Ban</Tag>}
                    </Link>
                  ),
                },
                { title: 'Người đứng đầu', dataIndex: 'headName' },
                { title: 'Trạng thái', render: (_: unknown, r) => <StatusTag status={r.status} /> },
                { title: 'Chung', align: 'right', render: (_: unknown, r) => num(r.generalScore) },
                { title: 'Kết quả', align: 'right', render: (_: unknown, r) => num(r.resultScore) },
                { title: 'Tổng', align: 'right', render: (_: unknown, r) => num(r.totalScore) },
                { title: 'Xếp loại', render: (_: unknown, r) => <RatingTag rating={r.rating} /> },
                { title: 'Cảnh báo', align: 'right', render: (_: unknown, r) => (r.warnings > 0 ? <Tag color="orange">{r.warnings}</Tag> : '–') },
              ]}
            />
          </Card>

          {report.notes.length > 0 && (
            <Alert type="info" showIcon message="Lưu ý" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>} />
          )}

          {draft && (
            <Card size="small" title="Dự thảo văn bản (điền mẫu, không dùng AI)">
              <Collapse
                items={[
                  {
                    key: draft.title,
                    label: draft.title,
                    children: (
                      <>
                        <Alert type="warning" showIcon message={draft.disclaimer} style={{ marginBottom: 12 }} />
                        <Button icon={<DownloadOutlined />} style={{ marginBottom: 12 }} href={`${API_URL}/reporting/periods/${report.period.id}/units/draft/file`}>
                          Tải tệp Word (.docx)
                        </Button>
                        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{draft.body}</Typography.Paragraph>
                      </>
                    ),
                  },
                ]}
              />
            </Card>
          )}
        </>
      )}
    </Space>
  );
}
