'use client';

import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import type { EvaluationStatus, EvaluationTask } from '@/lib/api';
import { apiCall } from '@/lib/client';
import CatalogItemPicker from '@/components/catalog-item-picker';
import type { PickerGroup, PickerItem, PickerTask } from '@/components/catalog-item-picker';
import { QUALITY_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

interface Props {
  evaluationId: string;
  status: EvaluationStatus;
  periodOpen: boolean;
  permissions: string[];
  tasks: EvaluationTask[];
  /** Điểm chung đã tự chấm, dùng làm giá trị gợi ý khi thẩm định. */
  selfGeneralScore: number | null;
  /** Cán bộ lãnh đạo, quản lý được chấm thêm tiêu chí D; unitResult là gợi ý từ xếp loại của cấp dưới. */
  isLeader: boolean;
  suggestedUnitResult: number | null;
  /** Công việc trong danh mục của kỳ, để chọn khi giao chỉ tiêu. */
  catalogItems: PickerItem[];
  catalogGroups: PickerGroup[];
  catalogTasks: PickerTask[];
}

const LEADERSHIP_OPTIONS = [
  { value: 1, label: 'Đạt 100%' },
  { value: 0.5, label: 'Đạt 50%' },
];

const blank = (s?: string) => (s?.trim() ? s.trim() : undefined);
const GENERAL_RULES = [{ required: true, message: 'Nhập điểm' }];

export default function EvaluationActions({ evaluationId, status, periodOpen, permissions, tasks, selfGeneralScore, isLeader, suggestedUnitResult, catalogItems, catalogGroups, catalogTasks }: Props) {
  const { run, busy } = useAction();
  const can = (p: string) => permissions.includes(p);
  const [returning, setReturning] = useState(false);
  const [approving, setApproving] = useState(false);
  const [assignForm] = Form.useForm<{ code: string; planned: number }>();
  const [selfForm] = Form.useForm<Record<string, number | string | undefined>>();
  const [reviewForm] = Form.useForm<Record<string, number | string | undefined>>();
  const [returnForm] = Form.useForm<{ reason: string }>();
  const [approveForm] = Form.useForm<{ comment?: string }>();

  const planned = status === 'PLANNED';
  const canAssign = periodOpen && planned && can('evaluation:assign');
  const canSelf = periodOpen && planned && can('evaluation:self');
  const canReview = periodOpen && status === 'SELF_SUBMITTED' && can('evaluation:review');
  const canApprove = periodOpen && status === 'REVIEWED' && can('evaluation:approve');

  if (!canAssign && !canSelf && !canReview && !canApprove) return null;

  const saveResults = async (v: Record<string, number | string | undefined>) => {
    for (const t of tasks.filter((x) => x.sourceAssignmentIds.length === 0)) {
      await apiCall('PATCH', `/evaluation/tasks/${t.id}/result`, { completedQuantity: Number(v[`done-${t.id}`] ?? 0), evidence: blank(v[`ev-${t.id}`] as string | undefined) });
    }
  };

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {canAssign && (
        <Card size="small" title="Giao chỉ tiêu">
          <Form
            form={assignForm}
            layout="inline"
            onFinish={(v) =>
              run(
                async () => {
                  await apiCall('POST', `/evaluation/evaluations/${evaluationId}/tasks`, { catalogItemCode: v.code, plannedQuantity: v.planned });
                  assignForm.resetFields();
                },
                { success: 'Đã thêm chỉ tiêu' },
              )
            }
          >
            <Form.Item name="code" rules={[{ required: true, message: 'Chọn nhiệm vụ' }]}>
              <CatalogItemPicker items={catalogItems} groups={catalogGroups} tasks={catalogTasks} exclude={tasks.map((t) => t.catalogItemCode)} />
            </Form.Item>
            <Form.Item name="planned" rules={[{ required: true, message: 'Nhập số lượng' }]}>
              <InputNumber min={1} precision={0} placeholder="Số lượng giao" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              Thêm
            </Button>
          </Form>
          {tasks.length > 0 && (
            <Space wrap style={{ marginTop: 12 }}>
              <Typography.Text type="secondary">Gỡ chỉ tiêu:</Typography.Text>
              {tasks.filter((t) => t.sourceAssignmentIds.length === 0).map((t) => (
                <Popconfirm
                  key={t.id}
                  title={`Gỡ chỉ tiêu ${t.catalogItemCode}?`}
                  okText="Gỡ"
                  okButtonProps={{ danger: true }}
                  cancelText="Hủy"
                  onConfirm={() => run(async () => void (await apiCall('DELETE', `/evaluation/tasks/${t.id}`)), { success: 'Đã gỡ chỉ tiêu' })}
                >
                  <Button size="small" danger>
                    {t.catalogItemCode}
                  </Button>
                </Popconfirm>
              ))}
            </Space>
          )}
        </Card>
      )}

      {canSelf && (
        <Card size="small" title="Cán bộ tự đánh giá">
          <Form
            form={selfForm}
            layout="vertical"
            initialValues={Object.fromEntries(tasks.flatMap((t) => [[`done-${t.id}`, t.completedQuantity], [`ev-${t.id}`, t.evidence ?? '']]))}
          >
            {tasks.length === 0 && <Typography.Paragraph type="secondary">Chưa có chỉ tiêu nào được giao.</Typography.Paragraph>}
            {tasks.map((t) =>
              t.sourceAssignmentIds.length > 0 ? (
                <Typography.Paragraph key={t.id}>
                  <Typography.Text strong>{t.catalogItemCode}</Typography.Text>: đã hoàn thành {t.completedQuantity}/{t.plannedQuantity} (lấy từ việc được giao, cấp trên đã xác nhận, không sửa ở đây).
                </Typography.Paragraph>
              ) : (
              <Space key={t.id} align="start" wrap>
                <Typography.Text strong style={{ lineHeight: '32px', width: 60, display: 'inline-block' }}>
                  {t.catalogItemCode}
                </Typography.Text>
                <Form.Item name={`done-${t.id}`} label={`Hoàn thành (giao ${t.plannedQuantity})`}>
                  <InputNumber min={0} precision={0} />
                </Form.Item>
                <Form.Item name={`ev-${t.id}`} label="Minh chứng">
                  <Input maxLength={2000} style={{ width: 360 }} />
                </Form.Item>
              </Space>
              ),
            )}
            <Space align="start" wrap>
              <Form.Item name="general" label="Điểm tiêu chí chung (0–30)" rules={GENERAL_RULES}>
                <InputNumber min={0} max={30} step={0.5} />
              </Form.Item>
              <Form.Item name="comment" label="Nhận xét">
                <Input maxLength={2000} style={{ width: 360 }} />
              </Form.Item>
            </Space>
            <Space>
              <Button loading={busy} onClick={() => run(async () => saveResults(selfForm.getFieldsValue()), { success: 'Đã lưu kết quả' })}>
                Lưu kết quả
              </Button>
              <Button
                type="primary"
                loading={busy}
                onClick={async () => {
                  const v = await selfForm.validateFields().catch(() => null);
                  if (!v) return;
                  await run(
                    async () => {
                      await saveResults(v);
                      await apiCall('POST', `/evaluation/evaluations/${evaluationId}/self-submit`, { generalScore: Number(v.general), comment: blank(v.comment as string | undefined) });
                    },
                    { success: 'Đã gửi thẩm định' },
                  );
                }}
              >
                Lưu và gửi thẩm định
              </Button>
            </Space>
          </Form>
        </Card>
      )}

      {canReview && (
        <Card size="small" title="Thẩm định">
          <Form
            form={reviewForm}
            layout="vertical"
            initialValues={{
              general: selfGeneralScore ?? undefined,
              ...(isLeader && suggestedUnitResult !== null ? { 'lead-unit': suggestedUnitResult } : {}),
              ...Object.fromEntries(tasks.flatMap((t) => [[`c-${t.id}`, t.completedQuantity], [`q-${t.id}`, t.qualityLevel ?? undefined]])),
            }}
            onFinish={(v) =>
              run(
                async () => {
                  await apiCall('POST', `/evaluation/evaluations/${evaluationId}/review`, {
                    generalScore: Number(v.general),
                    comment: blank(v.comment as string | undefined),
                    ...(isLeader ? { leadership: { unitResult: v['lead-unit'], organizing: v['lead-org'], solidarity: v['lead-sol'] } } : {}),
                    tasks: tasks.map((t) => ({ taskId: t.id, qualityLevel: v[`q-${t.id}`] as number | undefined, completedQuantity: v[`c-${t.id}`] as number | undefined })),
                  });
                },
                { success: 'Đã chốt thẩm định' },
              )
            }
          >
            {tasks.map((t) => (
              <Space key={t.id} align="start" wrap>
                <Typography.Text strong style={{ lineHeight: '32px', width: 60, display: 'inline-block' }}>
                  {t.catalogItemCode}
                </Typography.Text>
                <Form.Item name={`c-${t.id}`} label="Hoàn thành">
                  <InputNumber min={0} precision={0} />
                </Form.Item>
                <Form.Item name={`q-${t.id}`} label="Chất lượng" rules={[{ required: true, message: 'Chọn mức' }]}>
                  <Select placeholder="Chọn mức" style={{ width: 240 }} options={[1, 2, 3].map((q) => ({ value: q, label: QUALITY_LABELS[q] }))} />
                </Form.Item>
              </Space>
            ))}
            {isLeader && (
              <Card size="small" type="inner" title="Tiêu chí D: lãnh đạo, chỉ đạo, điều hành (cán bộ lãnh đạo, quản lý)" style={{ marginBottom: 16 }}>
                <Form.Item
                  name="lead-unit"
                  label="Kết quả hoạt động của đơn vị"
                  extra={
                    suggestedUnitResult === null
                      ? '100% nếu mọi công chức thuộc quyền từ hoàn thành nhiệm vụ trở lên; 50% nếu có người không hoàn thành. Chưa có xếp loại cấp dưới trong kỳ này để gợi ý.'
                      : `Gợi ý từ xếp loại cấp dưới trong kỳ: ${suggestedUnitResult === 1 ? '100%' : '50%'}. 100% nếu mọi công chức thuộc quyền từ hoàn thành nhiệm vụ trở lên; 50% nếu có người không hoàn thành.`
                  }
                  rules={[{ required: true, message: 'Chọn mức' }]}
                >
                  <Select placeholder="Chọn mức" style={{ width: 200 }} options={LEADERSHIP_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="lead-org"
                  label="Khả năng tổ chức triển khai nhiệm vụ"
                  extra="100% nếu hoàn thành đầy đủ nhiệm vụ đúng hạn, bảo đảm chất lượng, có sáng kiến hoặc giải pháp hiệu quả; 50% nếu có tồn tại, hạn chế, chậm trễ kéo dài."
                  rules={[{ required: true, message: 'Chọn mức' }]}
                >
                  <Select placeholder="Chọn mức" style={{ width: 200 }} options={LEADERSHIP_OPTIONS} />
                </Form.Item>
                <Form.Item
                  name="lead-sol"
                  label="Năng lực tập hợp, đoàn kết công chức"
                  extra="100% nếu duy trì môi trường làm việc đoàn kết, phối hợp hiệu quả; 50% nếu phát sinh phản ánh, khiếu nại, mâu thuẫn mất đoàn kết kéo dài."
                  rules={[{ required: true, message: 'Chọn mức' }]}
                  style={{ marginBottom: 0 }}
                >
                  <Select placeholder="Chọn mức" style={{ width: 200 }} options={LEADERSHIP_OPTIONS} />
                </Form.Item>
              </Card>
            )}
            <Space align="start" wrap>
              <Form.Item name="general" label="Điểm tiêu chí chung (0–30)" rules={GENERAL_RULES}>
                <InputNumber min={0} max={30} step={0.5} />
              </Form.Item>
              <Form.Item name="comment" label="Nhận xét">
                <Input maxLength={2000} style={{ width: 360 }} />
              </Form.Item>
            </Space>
            <Space>
              <Button type="primary" htmlType="submit" loading={busy}>
                Chốt thẩm định
              </Button>
              <Button danger onClick={() => setReturning(true)}>
                Trả lại để chỉnh sửa
              </Button>
            </Space>
          </Form>
          <Modal
            title="Trả lại hồ sơ"
            open={returning}
            onCancel={() => setReturning(false)}
            onOk={() => returnForm.submit()}
            okText="Trả lại"
            cancelText="Hủy"
            confirmLoading={busy}
            destroyOnHidden
          >
            <Form
              form={returnForm}
              layout="vertical"
              onFinish={async (v) => {
                const ok = await run(async () => void (await apiCall('POST', `/evaluation/evaluations/${evaluationId}/return`, { reason: v.reason.trim() })), { success: 'Đã trả lại hồ sơ' });
                if (ok) setReturning(false);
              }}
            >
              <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: 'Nhập lý do' }]}>
                <Input.TextArea rows={3} maxLength={2000} />
              </Form.Item>
            </Form>
          </Modal>
        </Card>
      )}

      {canApprove && (
        <Card size="small" title="Phê duyệt">
          <Typography.Paragraph>Sau khi phê duyệt, hồ sơ bị khóa và không sửa được.</Typography.Paragraph>
          <Button type="primary" onClick={() => setApproving(true)}>
            Phê duyệt
          </Button>
          <Modal
            title="Phê duyệt hồ sơ"
            open={approving}
            onCancel={() => setApproving(false)}
            onOk={() => approveForm.submit()}
            okText="Phê duyệt"
            cancelText="Hủy"
            confirmLoading={busy}
            destroyOnHidden
          >
            <Form
              form={approveForm}
              layout="vertical"
              onFinish={async (v) => {
                const ok = await run(async () => void (await apiCall('POST', `/evaluation/evaluations/${evaluationId}/approve`, { comment: blank(v.comment) })), { success: 'Đã phê duyệt' });
                if (ok) setApproving(false);
              }}
            >
              <Form.Item name="comment" label="Ý kiến (tùy chọn)">
                <Input.TextArea rows={3} maxLength={2000} />
              </Form.Item>
            </Form>
          </Modal>
        </Card>
      )}
    </Space>
  );
}
