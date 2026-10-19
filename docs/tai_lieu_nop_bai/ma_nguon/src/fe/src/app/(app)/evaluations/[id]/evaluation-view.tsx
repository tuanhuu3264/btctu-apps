'use client';

import { Alert, Card, Col, Descriptions, Row, Statistic, Steps, Table, Tag, Typography } from 'antd';
import { RatingTag, StatusTag } from '@/components/status-tags';
import type { EvaluationDetail, EvaluationTask, PeriodAverage } from '@/lib/api';
import { EXCEPTION_LABELS, num, QUALITY_LABELS } from '@/lib/labels';

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
  const exception = ev.scoringParams?.exception ?? null;

  return (
    <>
      <Steps
        size="small"
        style={{ marginBottom: 24, background: '#fff', padding: 16, borderRadius: 8 }}
        current={STEP_INDEX[ev.status]}
        status={ev.status === 'APPROVED' ? 'finish' : 'process'}
        items={[{ title: 'Giao mục tiêu, thực hiện' }, { title: 'Tự đánh giá' }, { title: 'Thẩm định' }, { title: 'Phê duyệt' }]}
      />

      {ev.notRatedReason && <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Không xếp loại" description={ev.notRatedReason} />}
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

      {detail.yearAverage && (
        <Card size="small" title="Điểm năm bằng trung bình cộng các tháng đã phê duyệt" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            Theo Nghị định 335 Điều 17.3, điểm năm là trung bình cộng điểm các tháng. Cần ít nhất 6 tháng đã phê duyệt mới xếp loại (Điều 11.1). Người thẩm định không nhập lại điểm.
          </Typography.Paragraph>
          <Table
            rowKey="month"
            size="small"
            pagination={false}
            dataSource={detail.yearAverage.months}
            locale={{ emptyText: 'Chưa có tháng nào được phê duyệt.' }}
            columns={[
              { title: 'Tháng', dataIndex: 'label' },
              { title: 'Tiêu chí chung', dataIndex: 'generalScore', align: 'right', render: (n: number) => num(n) },
              { title: 'Kết quả nhiệm vụ', dataIndex: 'resultScore', align: 'right', render: (n: number) => num(n) },
              { title: 'Tổng điểm', dataIndex: 'totalScore', align: 'right', render: (n: number) => num(n) },
            ]}
            summary={() =>
              detail.yearAverage && detail.yearAverage.months.length > 0 ? (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}><b>Trung bình ({detail.yearAverage.months.length} tháng)</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><b>{num(detail.yearAverage.generalScore)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><b>{num(detail.yearAverage.resultScore)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><b>{num(detail.yearAverage.totalScore)}</b></Table.Summary.Cell>
                </Table.Summary.Row>
              ) : null
            }
          />
          {detail.yearAverage.missing.length > 0 && (
            <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
              Tháng chưa có hồ sơ đã phê duyệt: {detail.yearAverage.missing.join(', ')}.
            </Typography.Paragraph>
          )}
          {detail.yearAverage.exempt.length > 0 && (
            <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
              Tháng nghỉ có căn cứ, không tính vào trung bình: {detail.yearAverage.exempt.join(', ')} (Nghị định 335 Điều 11.2).
            </Typography.Paragraph>
          )}
        </Card>
      )}

      {detail.yearAverage && (
        <Card size="small" title="Tổng hợp theo quý và 6 tháng (để theo dõi)" style={{ marginBottom: 16 }}>
          <Typography.Paragraph type="secondary">
            Trung bình cộng điểm các tháng đã phê duyệt trong quý (Nghị định 335 Điều 17.3). Điểm quý chính thức là hồ sơ quý chấm trực tiếp, bảng này chỉ để đối chiếu.
          </Typography.Paragraph>
          <Table<PeriodAverage>
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={detail.yearAverage.periods}
            scroll={{ x: 640 }}
            columns={[
              { title: 'Khoảng', dataIndex: 'label' },
              { title: 'Tháng có điểm', dataIndex: 'approved', align: 'right', render: (n: number, p) => `${n}/${p.span.length}` },
              { title: 'Thiếu', dataIndex: 'missing', render: (m: number[]) => (m.length ? m.join(', ') : '–') },
              { title: 'Nghỉ', dataIndex: 'exempt', render: (m: number[]) => (m.length ? m.join(', ') : '–') },
              { title: 'Tổng điểm TB', dataIndex: 'totalScore', align: 'right', render: (n: number | null) => num(n) },
              { title: 'Xếp loại tham khảo', dataIndex: 'rating', render: (r: PeriodAverage['rating']) => <RatingTag rating={r} /> },
              { title: '', dataIndex: 'complete', render: (c: boolean) => (c ? null : <Tag color="orange">Chưa đủ tháng</Tag>) },
            ]}
          />
        </Card>
      )}

      <Card size="small" title={detail.yearAverage ? 'Chỉ tiêu (tham khảo, không dùng tính điểm năm)' : 'Chỉ tiêu'} style={{ marginBottom: 16 }}>
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
              render: (_: unknown, t: EvaluationTask) => {
                if (t.sourceAssignmentIds.length === 0) return '–';
                const waived = t.waivedLateCount + t.waivedReworkCount;
                return (
                  <>
                    {t.lateCount} / {t.reworkCount}
                    {waived > 0 && (
                      <div style={{ color: '#888', fontSize: 12 }}>
                        miễn trừ: chậm {t.waivedLateCount}, chưa đạt {t.waivedReworkCount}
                      </div>
                    )}
                  </>
                );
              },
            },
          ]}
        />
      </Card>

      <Card size="small" title={final ? 'Điểm' : 'Điểm (tạm tính)'} style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} md={6}><Statistic title="Tự chấm tiêu chí chung" value={detail.yearAverage ? '–' : num(ev.selfGeneralScore)} /></Col>
          <Col xs={12} md={6}><Statistic title={detail.yearAverage ? 'Tiêu chí chung (trung bình)' : 'Tiêu chí chung (thẩm định)'} value={num(detail.yearAverage && !final ? detail.yearAverage.generalScore : ev.generalScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Kết quả nhiệm vụ (tối đa 70)" value={num(preview.resultScore)} /></Col>
          <Col xs={12} md={6}><Statistic title="Tổng điểm" value={num(preview.totalScore)} styles={{ content: { color: '#b71c1c' } }} /></Col>
        </Row>
        <div style={{ marginTop: 12 }}>
          Xếp loại: <RatingTag rating={preview.rating} />
        </div>
        {detail.yearConditions.length > 0 && (
          <Alert
            style={{ marginTop: 12 }}
            type={exception ? 'info' : 'error'}
            showIcon
            title={exception ? 'Có điều kiện "Không hoàn thành nhiệm vụ", người phê duyệt đã áp dụng ngoại lệ' : 'Có điều kiện xếp loại "Không hoàn thành nhiệm vụ" (39-QĐ/TU Điều 11 mục 4)'}
            description={
              <>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {detail.yearConditions.map((c) => (
                    <li key={c.code}>
                      {c.text} ({c.basis})
                    </li>
                  ))}
                </ul>
                {exception && (
                  <p style={{ margin: '8px 0 0' }}>
                    Ngoại lệ: {EXCEPTION_LABELS[exception.code] ?? exception.code}. Căn cứ: {exception.note}
                  </p>
                )}
              </>
            }
          />
        )}
        {detail.generalCriteria && (ev.selfGeneral || ev.general) && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text strong>Tiêu chí chung theo mục: {detail.generalCriteria.groupLabel}</Typography.Text>
            <Table
              size="small"
              style={{ marginTop: 8 }}
              rowKey="code"
              pagination={false}
              scroll={{ x: true }}
              dataSource={detail.generalCriteria.items}
              columns={[
                { title: 'Mục', dataIndex: 'code', width: 60 },
                { title: 'Nội dung', dataIndex: 'name', ellipsis: { showTitle: true } },
                { title: 'Tối đa', dataIndex: 'max', align: 'right', width: 70, render: (n: number) => num(n) },
                ...(
                  [
                    ['Tự chấm', ev.selfGeneral],
                    ['Thẩm định', ev.general],
                  ] as const
                ).map(([title, marks]) => ({
                  title,
                  width: 130,
                  render: (_: unknown, i: { code: string }) => {
                    const m = marks?.items.find((x) => x.code === i.code);
                    return m ? <Tag color={m.ok ? 'green' : 'red'}>{m.ok ? 'Đảm bảo' : 'Không đảm bảo'}</Tag> : '–';
                  },
                })),
                {
                  title: 'Căn cứ',
                  render: (_: unknown, i: { code: string }) => {
                    const notes = (
                      [
                        ['Tự chấm', ev.selfGeneral],
                        ['Thẩm định', ev.general],
                      ] as const
                    ).flatMap(([who, marks]) => {
                      const note = marks?.items.find((m) => m.code === i.code)?.note;
                      return note ? [`${who}: ${note}`] : [];
                    });
                    return notes.join('; ') || '–';
                  },
                },
              ]}
            />
          </div>
        )}
        {detail.isSupport && !detail.yearAverage && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text strong>Ba tiêu chí của người lao động hỗ trợ, phục vụ (Sổ tay Bộ Nội vụ Chương III)</Typography.Text>
            <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
              {(
                [
                  ['quality', 'a. Chất lượng công việc'],
                  ['compliance', 'b. Tuân thủ quy trình'],
                  ['efficiency', 'c. Hiệu quả công việc'],
                ] as const
              ).map(([k, label]) => (
                <Col key={k} xs={12} md={6}>
                  <Statistic title={label} value={ev.support ? `${ev.support[k]}%` : '–'} />
                  <Typography.Text type="secondary">Tự đánh giá: {ev.selfSupport ? `${ev.selfSupport[k]}%` : '–'}</Typography.Text>
                </Col>
              ))}
              <Col xs={12} md={6}><Statistic title="Điểm đánh giá" value={pct(preview.breakdown?.kpi ?? null)} /></Col>
            </Row>
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              Điểm đánh giá = (a + b + c) / 3; điểm kết quả = điểm đánh giá × 70. Cột lớn là điểm của người quản lý (căn cứ tính điểm); chưa thẩm định thì điểm tạm tính theo điểm tự đánh giá.
            </Typography.Paragraph>
          </div>
        )}
        {preview.breakdown && !detail.isSupport && (
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
              Điểm kết quả = KPI × 70. KPI = (a + b + c + d + đ + e) / 6 với cán bộ lãnh đạo, quản lý (cột D là trung bình của ba tiêu chí d, đ, e); (a + b + c) / 3 với người khác (Nghị định 335/2025 Điều 16).
            </Typography.Paragraph>
          </div>
        )}
        {detail.warnings.map((w) => <Alert key={w} style={{ marginTop: 12 }} type="warning" showIcon message={w} />)}
        {!preview.complete && !detail.yearAverage && (
          <Alert
            style={{ marginTop: 12 }}
            type="info"
            showIcon
            message={detail.isSupport ? 'Điểm mới là tạm tính: chưa chấm ba tiêu chí chất lượng, tuân thủ quy trình, hiệu quả.' : 'Điểm mới là tạm tính: còn chỉ tiêu có kết quả nhưng chưa đánh giá chất lượng, hoặc cán bộ lãnh đạo chưa được chấm tiêu chí D.'}
          />
        )}
        {ev.selfComment && <p style={{ marginBottom: 0 }}>Nhận xét của cán bộ: {ev.selfComment}</p>}
        {ev.reviewComment && <p style={{ marginBottom: 0 }}>Nhận xét thẩm định: {ev.reviewComment}</p>}
        {ev.approveComment && <p style={{ marginBottom: 0 }}>Ý kiến phê duyệt: {ev.approveComment}</p>}
      </Card>
    </>
  );
}
