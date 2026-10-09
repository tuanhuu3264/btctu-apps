'use client';

import { Alert, Card, Col, Descriptions, Row, Statistic, Steps, Table, Tag, Typography } from 'antd';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { EvaluationDetail, EvaluationTask } from '@/lib/api';
import { num, QUALITY_LABELS } from '@/lib/labels';

const pct = (x: number | null) => (x === null ? '–' : `${(x * 100).toFixed(1).replace('.', ',')}%`);

interface Props {
  detail: EvaluationDetail;
  subject: { fullName: string; positionTitle: string } | null;
  reviewerName: string;
  approverName: string;
}

const STEP_INDEX = { PLANNED: 0, SELF_SUBMITTED: 1, REVIEWED: 2, APPROVED: 3 } as const;

export default function EvaluationView({ detail, subject, reviewerName, approverName }: Props) {
  const { evaluation: ev, period, tasks, preview } = detail;
  const final = ev.status === 'REVIEWED' || ev.status === 'APPROVED';

  return (
    <>
      <Steps
        size="small"
        style={{ marginBottom: 24, background: '#fff', padding: 16, borderRadius: 8 }}
        current={STEP_INDEX[ev.status]}
        status={ev.status === 'APPROVED' ? 'finish' : 'process'}
        items={[{ title: 'Giao mục tiêu, thực hiện' }, { title: 'Tự đánh giá' }, { title: 'Thẩm định' }, { title: 'Phê duyệt' }]}
      />

      {ev.returnReason && ev.status === 'PLANNED' && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Hồ sơ bị trả lại" description={ev.returnReason} />}

      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, md: 2 }}
        style={{ marginBottom: 16, background: '#fff' }}
        items={[
          { key: 'n', label: 'Cán bộ', children: subject?.fullName ?? ev.personId },
          { key: 'p', label: 'Chức vụ', children: subject?.positionTitle ?? '–' },
          { key: 'k', label: 'Kỳ', children: <>{period.label} {period.status === 'OPEN' ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng</Tag>}</> },
          { key: 's', label: 'Trạng thái', children: <StatusTag status={ev.status} /> },
          { key: 'r', label: 'Người thẩm định', children: reviewerName },
          { key: 'a', label: 'Người phê duyệt', children: approverName },
        ]}
      />

      <Card size="small" title="Chỉ tiêu" style={{ marginBottom: 16 }}>
        <Table<EvaluationTask>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={tasks}
          locale={{ emptyText: 'Chưa giao chỉ tiêu nào.' }}
          scroll={{ x: 980 }}
          columns={[
            { title: 'Mã', dataIndex: 'catalogItemCode', width: 80 },
            { title: 'Nhiệm vụ', dataIndex: 'name' },
            { title: 'Hệ số', dataIndex: 'coefficient', align: 'right', render: (c: number | null) => num(c) },
            { title: 'Giao', dataIndex: 'plannedQuantity', align: 'right' },
            { title: 'Hoàn thành', dataIndex: 'completedQuantity', align: 'right' },
            { title: 'Chất lượng', dataIndex: 'qualityLevel', render: (q: number | null) => (q ? QUALITY_LABELS[q] : '–') },
            { title: 'Minh chứng', dataIndex: 'evidence', render: (e: string | null) => e ?? '–' },
            {
              title: 'Nguồn',
              render: (_: unknown, t: EvaluationTask) =>
                t.sourceAssignmentIds.length > 0 ? (
                  <>
                    <Tag color="geekblue">Từ {t.sourceAssignmentIds.length} việc được giao</Tag>
                    {t.sourceTaskTitles.length > 0 && <div style={{ color: '#888' }}>Nhiệm vụ: {t.sourceTaskTitles.join('; ')}</div>}
                  </>
                ) : (
                  <Tag>Nhập tay</Tag>
                ),
            },
            {
              title: 'Chậm / chưa đạt',
              render: (_: unknown, t: EvaluationTask) => (t.sourceAssignmentIds.length > 0 ? `${t.lateCount} / ${t.reworkCount}` : '–'),
            },
          ]}
        />
      </Card>

      <Card size="small" title={final ? 'Điểm' : 'Điểm (tạm tính)'} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Statistic title="Tự chấm tiêu chí chung" value={num(ev.selfGeneralScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Tiêu chí chung (thẩm định)" value={num(ev.generalScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Kết quả nhiệm vụ (tối đa 70)" value={num(preview.resultScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Tổng điểm" value={num(preview.totalScore)} styles={{ content: { color: '#b71c1c' } }} /></Col>
        </Row>
        <div style={{ marginTop: 12 }}>
          Xếp loại: <RatingTag rating={preview.rating} />
        </div>
        {preview.breakdown && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text strong>Thành phần KPI (Phụ lục 2, 05-HD/TU)</Typography.Text>
            <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
              <Col xs={12} md={4}><Statistic title="A – Số lượng" value={pct(preview.breakdown.quantity)} /></Col>
              <Col xs={12} md={4}><Statistic title="B – Chất lượng" value={pct(preview.breakdown.quality)} /></Col>
              <Col xs={12} md={4}><Statistic title="C – Tiến độ" value={pct(preview.breakdown.timeliness)} /></Col>
              <Col xs={12} md={4}><Statistic title="D – Lãnh đạo, chỉ đạo" value={pct(preview.breakdown.leadership)} /></Col>
              <Col xs={12} md={4}><Statistic title="KPI" value={pct(preview.breakdown.kpi)} /></Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              Điểm kết quả = KPI × 70. KPI = (A + B + C + D) / 4 với cán bộ lãnh đạo, quản lý; (A + B + C) / 3 với người khác.
            </Typography.Paragraph>
          </div>
        )}
        {detail.warnings.map((w) => <Alert key={w} style={{ marginTop: 12 }} type="warning" showIcon message={w} />)}
        {!preview.complete && <Alert style={{ marginTop: 12 }} type="info" showIcon message="Điểm mới là tạm tính: còn chỉ tiêu có kết quả nhưng chưa đánh giá chất lượng, hoặc cán bộ lãnh đạo chưa được chấm tiêu chí D." />}
        {ev.selfComment && <p style={{ marginBottom: 0 }}>Nhận xét của cán bộ: {ev.selfComment}</p>}
        {ev.reviewComment && <p style={{ marginBottom: 0 }}>Nhận xét thẩm định: {ev.reviewComment}</p>}
        {ev.approveComment && <p style={{ marginBottom: 0 }}>Ý kiến phê duyệt: {ev.approveComment}</p>}
      </Card>
    </>
  );
}
