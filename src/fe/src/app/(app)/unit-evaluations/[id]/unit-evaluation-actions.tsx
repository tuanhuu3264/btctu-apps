'use client';

import { Button, Card, Form, Input, InputNumber, Modal, Space, Typography } from 'antd';
import { useState } from 'react';
import type { AxisDefinition, AxisKind, AxisScore, EvaluationStatus } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

interface Props {
  evaluationId: string;
  status: EvaluationStatus;
  periodOpen: boolean;
  permissions: string[];
  /** Người đăng nhập là người đứng đầu đơn vị này. */
  isHead: boolean;
  isBan: boolean;
  selfGeneralScore: number | null;
  selfResultScore: number | null;
  /** Trục đang bật (ADR-036); nhóm không có trục nào thì nhập một số. */
  axes: AxisDefinition[];
  /** Điểm gợi ý theo số liệu tham chiếu, theo mã trục. */
  suggested: Record<string, number>;
  /** Điểm trục đã tự chấm, làm giá trị ban đầu khi thẩm định. */
  selfAxisScores: AxisScore[] | null;
}

type ScoreForm = Record<string, number | string | undefined>;

const KIND_LABELS: Record<AxisKind, string> = { GENERAL: 'Tiêu chí chung (30 điểm)', RESULT: 'Kết quả thực hiện nhiệm vụ (70 điểm)' };

const blank = (s?: string) => (s?.trim() ? s.trim() : undefined);
const GENERAL_RULES = [{ required: true, message: 'Nhập điểm' }];

/**
 * Nút thao tác theo quyền và trạng thái. Máy chủ vẫn kiểm tra ai là người có thẩm quyền ở từng bước
 * (cấp trên theo cây vị trí; hồ sơ Ban do đại diện Ban Thường vụ), nên hiện nút rộng hơn là chấp nhận được.
 */
export default function UnitEvaluationActions({ evaluationId, status, periodOpen, permissions, isHead, isBan, selfGeneralScore, selfResultScore, axes, suggested, selfAxisScores }: Props) {
  const { run, busy } = useAction();
  const can = (p: string) => permissions.includes(p);
  const [returning, setReturning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [selfForm] = Form.useForm<ScoreForm>();
  const [reviewForm] = Form.useForm<ScoreForm>();
  const [returnForm] = Form.useForm<{ reason: string }>();
  const [approveForm] = Form.useForm<{ comment?: string }>();

  const base = `/unit-evaluation/${evaluationId}`;
  const canSelf = periodOpen && status === 'PLANNED' && isHead && can('evaluation:self');
  // Hồ sơ Ban chỉ do tài khoản đại diện Ban Thường vụ thẩm định, phê duyệt (ADR-030 mục 5).
  // Người đứng đầu không thẩm định hay phê duyệt hồ sơ của đơn vị mình.
  const canDecide = (needed: string) => !isHead && can(needed) && (isBan ? can('evaluation:decide-ban') : true);
  const canReview = periodOpen && status === 'SELF_SUBMITTED' && canDecide('evaluation:review');
  const canApprove = periodOpen && status === 'REVIEWED' && canDecide('evaluation:approve');
  const canReturn = (periodOpen && status === 'SELF_SUBMITTED' && canDecide('evaluation:review')) || (periodOpen && status === 'REVIEWED' && canDecide('evaluation:approve'));

  if (!canSelf && !canReview && !canApprove) return null;

  const axesOf = (kind: AxisKind) => axes.filter((a) => a.kind === kind);
  // Mỗi nhóm có trục đang bật thì chấm từng trục; không có thì nhập một số như ADR-030.
  const scoreFields = (
    <>
      {(['GENERAL', 'RESULT'] as AxisKind[]).map((kind) => {
        const list = axesOf(kind);
        const field = kind === 'GENERAL' ? 'general' : 'result';
        const max = kind === 'GENERAL' ? 30 : 70;
        return (
          <Card key={kind} size="small" type="inner" title={KIND_LABELS[kind]} style={{ marginBottom: 16 }}>
            {list.length === 0 ? (
              <Form.Item name={field} label={`Điểm (0–${max})`} rules={GENERAL_RULES} style={{ marginBottom: 0 }}>
                <InputNumber min={0} max={max} step={0.5} />
              </Form.Item>
            ) : (
              list.map((a) => (
                <Form.Item
                  key={a.code}
                  name={`ax-${a.code}`}
                  label={`${a.code}. ${a.name} (0–${a.maxPoints})`}
                  rules={GENERAL_RULES}
                  extra={suggested[a.code] !== undefined ? `Gợi ý theo số liệu tham chiếu: ${String(suggested[a.code]).replace('.', ',')} (tối đa ${a.maxPoints} nhân tỷ lệ việc hoàn thành đủ số lượng).` : undefined}
                >
                  <InputNumber min={0} max={a.maxPoints} step={0.5} />
                </Form.Item>
              ))
            )}
          </Card>
        );
      })}
      <Form.Item name="comment" label="Nhận xét">
        <Input maxLength={2000} style={{ width: 360 }} />
      </Form.Item>
    </>
  );
  const payload = (v: ScoreForm) => ({
    ...(axesOf('GENERAL').length === 0 ? { generalScore: Number(v.general) } : {}),
    ...(axesOf('RESULT').length === 0 ? { resultScore: Number(v.result) } : {}),
    ...(axes.length > 0 ? { axes: axes.map((a) => ({ code: a.code, score: Number(v[`ax-${a.code}`]) })) } : {}),
    comment: blank(v.comment as string | undefined),
  });
  // Giá trị ban đầu khi thẩm định: điểm tự chấm của người đứng đầu.
  const selfInitial: ScoreForm = {
    general: selfGeneralScore ?? undefined,
    result: selfResultScore ?? undefined,
    ...Object.fromEntries((selfAxisScores ?? []).map((s) => [`ax-${s.code}`, s.score])),
  };

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {canSelf && (
        <Card size="small" title="Người đứng đầu tự đánh giá và đề xuất điểm">
          <Form form={selfForm} layout="vertical" onFinish={(v) => run(async () => void (await apiCall('POST', `${base}/self-submit`, payload(v))), { success: 'Đã gửi thẩm định' })}>
            {scoreFields}
            <Button type="primary" htmlType="submit" loading={busy}>
              Gửi thẩm định
            </Button>
          </Form>
        </Card>
      )}

      {canReview && (
        <Card size="small" title="Thẩm định">
          <Form
            form={reviewForm}
            layout="vertical"
            initialValues={selfInitial}
            onFinish={(v) => run(async () => void (await apiCall('POST', `${base}/review`, payload(v))), { success: 'Đã chốt thẩm định' })}
          >
            {scoreFields}
            <Space>
              <Button type="primary" htmlType="submit" loading={busy}>
                Chốt thẩm định
              </Button>
              {canReturn && (
                <Button danger onClick={() => setReturning(true)}>
                  Trả lại để chỉnh sửa
                </Button>
              )}
            </Space>
          </Form>
        </Card>
      )}

      {canApprove && (
        <Card size="small" title="Công nhận kết quả">
          <Typography.Paragraph>Sau khi công nhận, hồ sơ bị khóa và không sửa được.</Typography.Paragraph>
          <Space>
            <Button type="primary" onClick={() => setApproving(true)}>
              Công nhận
            </Button>
            {canReturn && (
              <Button danger onClick={() => setReturning(true)}>
                Trả lại để chỉnh sửa
              </Button>
            )}
          </Space>
        </Card>
      )}

      <Modal title="Trả lại hồ sơ" open={returning} onCancel={() => setReturning(false)} onOk={() => returnForm.submit()} okText="Trả lại" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form
          form={returnForm}
          layout="vertical"
          onFinish={async (v) => {
            const ok = await run(async () => void (await apiCall('POST', `${base}/return`, { reason: v.reason.trim() })), { success: 'Đã trả lại hồ sơ' });
            if (ok) setReturning(false);
          }}
        >
          <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: 'Nhập lý do' }]}>
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Công nhận kết quả" open={approving} onCancel={() => setApproving(false)} onOk={() => approveForm.submit()} okText="Công nhận" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form
          form={approveForm}
          layout="vertical"
          onFinish={async (v) => {
            const ok = await run(async () => void (await apiCall('POST', `${base}/approve`, { comment: blank(v.comment) })), { success: 'Đã công nhận' });
            if (ok) setApproving(false);
          }}
        >
          <Form.Item name="comment" label="Ý kiến (tùy chọn)">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
