'use client';

import { DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Collapse, Empty, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { Draft, Period, PeriodReport, ReportRow, Stats } from '@/lib/api';
import { num, RATING_LABELS } from '@/lib/labels';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const pct = (r: number | null) => (r === null ? '–' : `${(r * 100).toFixed(1).replace('.', ',')}%`);
const RATINGS = ['XUAT_SAC', 'HOAN_THANH_TOT', 'HOAN_THANH', 'KHONG_HOAN_THANH'] as const;

type UnitRow = Stats & { unitCode: string; unitName: string };

interface Props {
  periods: Period[];
  report: PeriodReport | null;
  drafts: { report: Draft | null; decision: Draft | null; notice: Draft | null };
  canExport: boolean;
}

export default function ReportView({ periods, report, drafts, canExport }: Props) {
  const router = useRouter();
  const o = report?.overall;

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Select
          style={{ width: 220 }}
          placeholder="Chọn kỳ"
          value={report?.period.id}
          options={periods.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(id) => router.push(`/reports?period=${id}`)}
          notFoundContent="Chưa có kỳ đánh giá nào"
        />
        {report && (
          <>
            <span>
              {report.period.startDate} đến {report.period.endDate}{' '}
              {report.period.status === 'OPEN' ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng</Tag>}
            </span>
            {canExport && (
              <>
                <Button icon={<DownloadOutlined />} href={`${API_URL}/reporting/periods/${report.period.id}/export?format=xlsx`}>
                  Excel
                </Button>
                <Button icon={<DownloadOutlined />} href={`${API_URL}/reporting/periods/${report.period.id}/export?format=pdf`}>
                  PDF
                </Button>
              </>
            )}
          </>
        )}
      </Space>

      {!report || !o ? (
        <Empty description="Chưa có kỳ đánh giá nào" />
      ) : (
        <>
          {report.scope === 'LIMITED' && <Alert type="info" showIcon message="Chỉ gồm các hồ sơ trong phạm vi của bạn, không phải toàn bộ kỳ." />}
          {o.excellentQuota.exceeded && (
            <Alert
              type="warning"
              showIcon
              message={`Số "Hoàn thành xuất sắc" (${o.excellentQuota.excellent}) vượt mức tham khảo ${o.excellentQuota.allowed} (20% số hoàn thành tốt). Chỉ để tham khảo, hệ thống không tự đổi xếp loại.`}
            />
          )}

          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Tổng số hồ sơ" value={o.evaluations} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Đã phê duyệt" value={o.approved} suffix={`(${pct(o.completionRate)})`} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Chờ phê duyệt / đang thực hiện" value={`${o.pendingApproval} / ${o.inProgress}`} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Điểm trung bình" value={num(o.averageTotal)} suffix={`(${num(o.minTotal)} – ${num(o.maxTotal)})`} /></Card></Col>
          </Row>

          <Card size="small" title="Phân bố xếp loại (đã phê duyệt)">
            <Row gutter={[16, 16]}>
              {RATINGS.map((r) => (
                <Col xs={12} md={6} key={r}>
                  <Statistic title={RATING_LABELS[r]} value={o.ratings[r]} />
                </Col>
              ))}
            </Row>
          </Card>

          <Card size="small" title="Theo đơn vị">
            <Table<UnitRow>
              rowKey="unitCode"
              size="small"
              pagination={false}
              dataSource={report.byUnit}
              scroll={{ x: 760 }}
              columns={[
                { title: 'Đơn vị', dataIndex: 'unitName' },
                { title: 'Hồ sơ', dataIndex: 'evaluations', align: 'right' },
                { title: 'Đã duyệt', dataIndex: 'approved', align: 'right' },
                { title: 'Điểm TB', dataIndex: 'averageTotal', align: 'right', render: (n: number | null) => num(n) },
                { title: 'Xuất sắc', align: 'right', render: (_: unknown, u) => u.ratings.XUAT_SAC },
                { title: 'Tốt', align: 'right', render: (_: unknown, u) => u.ratings.HOAN_THANH_TOT },
                { title: 'Hoàn thành', align: 'right', render: (_: unknown, u) => u.ratings.HOAN_THANH },
                { title: 'Không HT', align: 'right', render: (_: unknown, u) => u.ratings.KHONG_HOAN_THANH },
              ]}
            />
          </Card>

          <Card size="small" title="Chi tiết">
            <Table<ReportRow>
              rowKey="evaluationId"
              size="small"
              pagination={report.rows.length > 20 ? { pageSize: 20 } : false}
              dataSource={report.rows}
              scroll={{ x: 960 }}
              columns={[
                { title: 'Họ và tên', dataIndex: 'fullName' },
                { title: 'Đơn vị', dataIndex: 'unitName' },
                { title: 'Chức vụ', dataIndex: 'positionTitle' },
                { title: 'Trạng thái', dataIndex: 'status', render: (s: ReportRow['status']) => <StatusTag status={s} /> },
                { title: 'Chung', dataIndex: 'generalScore', align: 'right', render: (n: number | null) => num(n) },
                { title: 'Kết quả', dataIndex: 'resultScore', align: 'right', render: (n: number | null) => num(n) },
                { title: 'Tổng', dataIndex: 'totalScore', align: 'right', render: (n: number | null) => num(n) },
                { title: 'Xếp loại', dataIndex: 'rating', render: (r: ReportRow['rating']) => <RatingTag rating={r} /> },
              ]}
            />
          </Card>

          {report.notes.length > 0 && <Alert type="info" showIcon message="Lưu ý" description={<ul style={{ margin: 0, paddingLeft: 20 }}>{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>} />}

          {(drafts.report || drafts.decision || drafts.notice) && (
            <Card size="small" title="Dự thảo văn bản (điền mẫu, không dùng AI)">
              <Collapse
                items={[drafts.report, drafts.notice, drafts.decision].flatMap((d) =>
                  d
                    ? [
                        {
                          key: d.title,
                          label: d.title,
                          children: (
                            <>
                              <Alert type="warning" showIcon message={d.disclaimer} style={{ marginBottom: 12 }} />
                              {report && (
                                <Button
                                  icon={<DownloadOutlined />}
                                  style={{ marginBottom: 12 }}
                                  href={`${API_URL}/reporting/periods/${report.period.id}/draft/file?kind=${d.kind === 'REPORT' ? 'report' : d.kind === 'NOTICE' ? 'notice' : 'decision'}`}
                                >
                                  Tải tệp Word (.docx)
                                </Button>
                              )}
                              <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{d.body}</Typography.Paragraph>
                            </>
                          ),
                        },
                      ]
                    : [],
                )}
              />
            </Card>
          )}
        </>
      )}
    </Space>
  );
}
