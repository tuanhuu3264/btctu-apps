'use client';

import { Alert, Form, Input, InputNumber, Modal, Select, Space, Typography } from 'antd';
import { useMemo } from 'react';
import type { CatalogItem, CatalogTask } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { DURATION_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

interface FormValues {
  taskId?: string;
  name: string;
  productUnits?: string;
  complexity: number;
  durationMode: 'LIMITED' | 'ACTUAL' | 'UNSPECIFIED';
  durationValue?: number | null;
  durationUnit?: 'HOUR' | 'DAY';
  points?: number | null;
  explanation?: string;
}

interface Props {
  versionId: string;
  /** Các nhiệm vụ của phiên bản, để chọn nhiệm vụ chứa công việc. */
  tasks: CatalogTask[];
  groups: { code: string; name: string }[];
  /** Có `item` là sửa, không có là thêm mới. */
  item?: CatalogItem;
  /** Nhiệm vụ chọn sẵn khi thêm mới (ví dụ thêm từ một nhiệm vụ đang mở). */
  presetTaskId?: string;
  onClose: () => void;
}

const blank = (s?: string) => (s?.trim() ? s.trim() : null);

/**
 * Biểu mẫu thêm hoặc sửa công việc của bản nháp (ADR-019). Khi thêm: chọn **nhiệm vụ trước**, các trường còn lại
 * hiện sau đó; mã công việc do máy chủ tự sinh theo nhóm của nhiệm vụ. Chỉ được dựng khi đang mở nên mỗi lần mở
 * là một form mới.
 */
export default function ItemEditor({ versionId, tasks, groups, item, presetTaskId, onClose }: Props) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<FormValues>();
  const taskId = Form.useWatch('taskId', form);
  const mode = Form.useWatch('durationMode', form);

  const adding = item === undefined;
  const chosen = tasks.find((t) => t.id === taskId);
  // Khi sửa chỉ chuyển được sang nhiệm vụ cùng nhóm; khi thêm chọn trong mọi nhóm.
  const selectable = item ? tasks.filter((t) => t.groupCode === item.groupCode) : tasks;
  const options = useMemo(
    () =>
      groups
        .map((g) => ({
          label: `Nhóm ${g.code}: ${g.name}`,
          options: selectable.filter((t) => t.groupCode === g.code).map((t) => ({ value: t.id, label: t.name })),
        }))
        .filter((g) => g.options.length > 0),
    [groups, selectable],
  );
  // Thêm mới: các trường chi tiết chỉ hiện sau khi đã chọn nhiệm vụ.
  const showDetails = !adding || Boolean(taskId);

  async function submit(v: FormValues) {
    const limited = v.durationMode === 'LIMITED';
    const ok = await run(
      async () => {
        if (item) {
          await apiCall('PATCH', `/catalog/items/${item.id}`, {
            ...(v.taskId && v.taskId !== item.taskId ? { taskId: v.taskId } : {}),
            name: v.name.trim(),
            productUnits: blank(v.productUnits),
            complexity: v.complexity,
            durationMode: v.durationMode,
            durationValue: limited ? (v.durationValue ?? null) : null,
            durationUnit: limited ? v.durationUnit : null,
            points: v.points ?? null,
            explanation: blank(v.explanation),
          });
        } else {
          await apiCall('POST', `/catalog/versions/${versionId}/items`, {
            taskId: v.taskId,
            name: v.name.trim(),
            ...(blank(v.productUnits) ? { productUnits: blank(v.productUnits) } : {}),
            complexity: v.complexity,
            durationMode: v.durationMode,
            ...(limited ? { durationValue: v.durationValue ?? undefined, durationUnit: v.durationUnit } : {}),
            ...(v.points != null ? { points: v.points } : {}),
            ...(blank(v.explanation) ? { explanation: blank(v.explanation) } : {}),
          });
        }
      },
      { success: item ? 'Đã lưu công việc' : 'Đã thêm công việc' },
    );
    if (ok) onClose();
  }

  return (
    <Modal
      title={item ? `Sửa công việc ${item.code}` : 'Thêm công việc'}
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Lưu"
      cancelText="Hủy"
      confirmLoading={busy}
      okButtonProps={{ disabled: !showDetails }}
      width={680}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={
          item
            ? {
                taskId: item.taskId,
                name: item.name,
                productUnits: item.productUnits ?? undefined,
                complexity: item.complexity,
                durationMode: item.durationMode,
                durationValue: item.durationValue,
                durationUnit: item.durationUnit ?? 'HOUR',
                points: item.points,
                explanation: item.explanation ?? undefined,
              }
            : { taskId: presetTaskId, complexity: 2, durationMode: 'UNSPECIFIED', durationUnit: 'HOUR' }
        }
      >
        {tasks.length === 0 && adding ? (
          <Alert type="info" showIcon message="Phiên bản này chưa có nhiệm vụ nào. Hãy thêm nhiệm vụ trước, rồi thêm công việc vào nhiệm vụ đó." />
        ) : (
          <Form.Item
            name="taskId"
            label={adding ? 'Bước 1: chọn nhiệm vụ' : 'Nhiệm vụ'}
            extra={adding ? 'Công việc luôn thuộc một nhiệm vụ. Mã công việc tự sinh theo nhóm của nhiệm vụ.' : 'Chỉ chuyển được sang nhiệm vụ cùng nhóm.'}
            rules={[{ required: true, message: 'Chọn nhiệm vụ' }]}
          >
            <Select showSearch optionFilterProp="label" placeholder="Chọn nhiệm vụ (gõ để lọc)" options={options} listHeight={400} />
          </Form.Item>
        )}

        {showDetails && (
          <>
            {adding && chosen && (
              <Typography.Paragraph type="secondary">
                Nhóm {chosen.groupCode}: công việc mới sẽ có mã tiếp theo của nhóm này.
              </Typography.Paragraph>
            )}
            <Form.Item name="name" label={adding ? 'Bước 2: tên công việc' : 'Tên công việc'} rules={[{ required: true, whitespace: true, message: 'Nhập tên công việc' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="productUnits" label="Sản phẩm, đơn vị đếm">
              <Input />
            </Form.Item>
            <Space size="large" align="start" wrap>
              <Form.Item name="complexity" label="Mức phức tạp (1–4)" rules={[{ required: true }]}>
                <InputNumber min={1} max={4} precision={0} />
              </Form.Item>
              <Form.Item name="points" label="Điểm chấm" extra="Để trống nếu chưa có định mức">
                <InputNumber min={0} style={{ width: 140 }} />
              </Form.Item>
            </Space>
            <Space size="large" align="start" wrap>
              <Form.Item name="durationMode" label="Thời gian tối đa" rules={[{ required: true }]}>
                <Select style={{ width: 160 }} options={(Object.keys(DURATION_LABELS) as (keyof typeof DURATION_LABELS)[]).map((m) => ({ value: m, label: DURATION_LABELS[m] }))} />
              </Form.Item>
              {mode === 'LIMITED' && (
                <>
                  <Form.Item name="durationValue" label="Hạn mức" rules={[{ required: true, message: 'Nhập hạn mức' }]}>
                    <InputNumber min={0} style={{ width: 120 }} />
                  </Form.Item>
                  <Form.Item name="durationUnit" label="Đơn vị">
                    <Select style={{ width: 100 }} options={[{ value: 'HOUR', label: 'giờ' }, { value: 'DAY', label: 'ngày' }]} />
                  </Form.Item>
                </>
              )}
            </Space>
            <Form.Item name="explanation" label="Diễn giải">
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}
