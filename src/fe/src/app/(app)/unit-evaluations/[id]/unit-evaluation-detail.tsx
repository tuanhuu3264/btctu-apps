'use client';

import { Alert, Card, Col, Descriptions, Row, Statistic, Steps, Table, Tag } from 'antd';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { AxisKind, UnitEvaluationView } from '@/lib/api';
import { num } from '@/lib/labels';

const STEP_INDEX = { PLANNED: 0, SELF_SUBMITTED: 1, REVIEWED: 2, APPROVED: 3 } as const;

interface AxisRow {
  code: string;
  name: string;
  kind: AxisKind;
  max: number;
  self: number | null;
  reviewed: number | null;
  suggested: number | null;
}

const pct = (part: number, whole: number) => (whole === 0 ? '–' : `${((part / whole) * 100).toFixed(1).replace('.', ',')}%`);

export default function UnitEvaluationDetail({ view, headName }: { view: UnitEvaluationView; headName: string }) {
  const { evaluation: ev, period, unit, metrics } = view;
  const decided = ev.status === 'REVIEWED' || ev.status === 'APPROVED';

  // Điểm từng trục: lấy ảnh chụp đã lưu cùng hồ sơ nếu có, chưa chấm thì lấy các trục đang bật (ADR-036).
  const snapshot = ev.axisScores ?? ev.selfAxisScores;
  const axisRows: AxisRow[] = (snapshot ?? (decided ? [] : view.axes.map((a) => ({ code: a.code, name: a.name, kind: a.kind, max: a.maxPoints, score: 0 })))).map((a) => ({
    code: a.code,
    name: a.name,
    kind: a.kind,
    max: a.max,
    self: ev.selfAxisScores?.find((s) => s.code === a.code)?.score ?? null,
    reviewed: ev.axisScores?.find((s) => s.code === a.code)?.score ?? null,
    suggested: view.suggested[a.code] ?? null,
  }));

  return (
    <>
      <Steps
        size="small"
        style={{ marginBottom: 24, background: '#fff', padding: 16, borderRadius: 8 }}
        current={STEP_INDEX[ev.status]}
        status={ev.status === 'APPROVED' ? 'finish' : 'process'}
        items={[{ title: 'Thực hiện nhiệm vụ' }, { title: 'Người đứng đầu tự đánh giá' }, { title: 'Thẩm định' }, { title: 'Công nhận' }]}
      />

      {ev.returnReason && ev.status === 'PLANNED' && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Hồ sơ bị trả lại" description={ev.returnReason} />}

      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, md: 2 }}
        style={{ marginBottom: 16, background: '#fff' }}
        items={[
          { key: 'u', label: 'Đơn vị', children: <>{unit.name} {unit.type === 'BAN' && <Tag>Ban</Tag>}</> },
          { key: 'h', label: 'Người đứng đầu', children: headName },
          { key: 'k', label: 'Kỳ', children: <>Năm {period.label} {period.status === 'OPEN' ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng</Tag>}</> },
          { key: 's', label: 'Trạng thái', children: <StatusTag status={ev.status} /> },
        ]}
      />

      <Card size="small" title="Điểm" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Statistic title="Tự chấm: tiêu chí chung (30)" value={num(ev.selfGeneralScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Tự chấm: kết quả nhiệm vụ (70)" value={num(ev.selfResultScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Thẩm định: tiêu chí chung (30)" value={num(ev.generalScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Thẩm định: kết quả nhiệm vụ (70)" value={num(ev.resultScore)} /></Col>
        </Row>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={12} md={6}><Statistic title="Tổng điểm" value={num(ev.totalScore)} styles={{ content: { color: '#b71c1c' } }} /></Col>
          <Col xs={12} md={18}>
            <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 14, marginBottom: 4 }}>{decided ? 'Xếp loại' : 'Xếp loại theo điểm tự chấm (đề xuất)'}</div>
            <RatingTag rating={decided ? ev.rating : view.proposedRating} />
          </Col>
        </Row>
        <p style={{ marginTop: 12, marginBottom: 0, color: '#888' }}>
          Điểm do người chấm nhập, không tự tính: cách chấm các tiêu chí do cấp tỉnh quy định (Nghị định 335/2025/NĐ-CP Điều 7.2) nên hệ thống chỉ cung cấp số liệu tham chiếu bên dưới.
        </p>
        {ev.selfComment && <p style={{ marginBottom: 0 }}>Nhận xét của người đứng đầu: {ev.selfComment}</p>}
        {ev.reviewComment && <p style={{ marginBottom: 0 }}>Nhận xét thẩm định: {ev.reviewComment}</p>}
        {ev.approveComment && <p style={{ marginBottom: 0 }}>Ý kiến công nhận: {ev.approveComment}</p>}
      </Card>

      {axisRows.length > 0 && (
        <Card size="small" title="Điểm theo trục" style={{ marginBottom: 16 }}>
          <Table<AxisRow>
            rowKey="code"
            size="small"
            pagination={false}
            dataSource={axisRows}
            scroll={{ x: 640 }}
            columns={[
              { title: 'Trục', render: (_: unknown, r: AxisRow) => <>{r.code}. {r.name}</> },
              { title: 'Nhóm', dataIndex: 'kind', width: 130, render: (k: AxisKind) => (k === 'GENERAL' ? <Tag>Tiêu chí chung</Tag> : <Tag color="geekblue">Kết quả nhiệm vụ</Tag>) },
              { title: 'Tối đa', dataIndex: 'max', width: 80, align: 'right', render: (n: number) => num(n) },
              { title: 'Tự chấm', dataIndex: 'self', width: 90, align: 'right', render: (n: number | null) => num(n) },
              { title: 'Thẩm định', dataIndex: 'reviewed', width: 100, align: 'right', render: (n: number | null) => num(n) },
              { title: 'Gợi ý', dataIndex: 'suggested', width: 80, align: 'right', render: (n: number | null) => (n === null ? '–' : num(n)) },
            ]}
          />
          <p style={{ marginTop: 12, marginBottom: 0, color: '#888' }}>
            Điểm tiêu chí chung và điểm kết quả là tổng các trục cùng nhóm. Gợi ý chỉ có với trục đo được bằng số liệu từ việc được giao; người chấm vẫn quyết định điểm.
          </p>
        </Card>
      )}

      <Card size="small" title={decided ? 'Số liệu tham chiếu (chụp lúc thẩm định)' : 'Số liệu tham chiếu (tính tại thời điểm xem)'} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={4}><Statistic title="Việc được giao" value={metrics.works} /></Col>
          <Col xs={12} md={5}><Statistic title="Hoàn thành đủ số lượng" value={pct(metrics.completed, metrics.works)} suffix={metrics.works > 0 ? `(${metrics.completed})` : undefined} /></Col>
          <Col xs={12} md={5}><Statistic title="Hoàn thành đúng hạn" value={pct(metrics.onTime, metrics.works)} suffix={metrics.works > 0 ? `(${metrics.onTime})` : undefined} /></Col>
          <Col xs={12} md={5}><Statistic title="Vượt mức" value={pct(metrics.exceeded, metrics.works)} suffix={metrics.works > 0 ? `(${metrics.exceeded})` : undefined} /></Col>
          <Col xs={12} md={5}><Statistic title="Có chậm tiến độ" value={pct(metrics.late, metrics.works)} suffix={metrics.works > 0 ? `(${metrics.late})` : undefined} /></Col>
        </Row>
        <p style={{ marginTop: 12, marginBottom: 0, color: '#888' }}>
          Tính từ các việc được giao đã chốt trong năm của cán bộ thuộc đơn vị{unit.type === 'BAN' ? ' (Ban gồm cả các phòng)' : ''}. Có thể chưa bao quát mọi nhiệm vụ của tập thể.
        </p>
        {view.warnings.map((w) => (
          <Alert key={w} style={{ marginTop: 12 }} type="warning" showIcon message={w} />
        ))}
      </Card>
    </>
  );
}
