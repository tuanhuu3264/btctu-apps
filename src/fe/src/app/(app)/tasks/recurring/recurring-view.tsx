'use client';

import { PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { RecurringFrequency, RecurringTemplate, WorkTask } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { AD_HOC_LEVEL_OPTIONS, AD_HOC_TASK_TITLE, dateText, FREQUENCY_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';
import { assigneeOptions } from '../assign-modal';

type DateValue = { format: (pattern: string) => string };

interface Props {
  templates: RecurringTemplate[];
  names: Record<string, string>;
  tasks: WorkTask[];
  assignees: { personId: string; label: string; unitId: string; positionId: string }[];
  catalogItems: { code: string; name: string }[];
  canAssign: boolean;
}

interface FormValues {
  assigneePersonId: string;
  source: 'CATALOG' | 'AD_HOC';
  catalogItemCode?: string;
  title?: string;
  difficulty?: number;
  plannedQuantity: number;
  frequency: RecurringFrequency;
  startDate: DateValue;
  endDate?: DateValue;
  dueAfterDays: number;
  note?: string;
}

/** Nhiệm vụ chứa việc sinh ra: nhiệm vụ "Việc đột xuất" của người nhận, hoặc "Việc định kỳ" cho việc danh mục; dùng lại nếu có, chưa có thì tạo. */
async function taskOf(assigneePersonId: string, title: string, tasks: WorkTask[]): Promise<string> {
  const same = tasks.find((t) => t.assigneePersonId === assigneePersonId && t.title.trim().toLowerCase() === title.toLowerCase());
  if (same) return same.id;
  const created = await apiCall<WorkTask>('POST', '/tasking/tasks', { assigneePersonId, title });
  if (!created) throw new Error('Không tạo được nhiệm vụ');
  return created.id;
}

const RECURRING_TASK_TITLE = 'Việc định kỳ';

/** Hộp thoại tạo mẫu việc lặp. Chỉ được dựng khi đang mở. */
function CreateModal({ assignees, tasks, catalogItems, onClose }: Pick<Props, 'assignees' | 'tasks' | 'catalogItems'> & { onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<FormValues>();
  const source = Form.useWatch('source', form);
  return (
    <Modal
      open
      width={640}
      title="Tạo mẫu việc lặp định kỳ"
      okText="Tạo mẫu"
      cancelText="Hủy"
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          const ok = await run(
            async () => {
              const taskId = await taskOf(v.assigneePersonId, v.source === 'AD_HOC' ? AD_HOC_TASK_TITLE : RECURRING_TASK_TITLE, tasks);
              await apiCall('POST', '/tasking/recurring', {
                taskId,
                source: v.source,
                ...(v.source === 'CATALOG' ? { catalogItemCode: v.catalogItemCode } : { title: v.title?.trim(), difficulty: v.difficulty }),
                plannedQuantity: v.plannedQuantity,
                frequency: v.frequency,
                startDate: v.startDate.format('YYYY-MM-DD'),
                ...(v.endDate ? { endDate: v.endDate.format('YYYY-MM-DD') } : {}),
                dueAfterDays: v.dueAfterDays,
                ...(v.note?.trim() ? { note: v.note.trim() } : {}),
              });
            },
            { success: 'Đã tạo mẫu việc lặp' },
          );
          if (ok) onClose();
        })
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Đến ngày đầu mỗi chu kỳ (thứ Hai, ngày 1, đầu quý, 1/1), hệ thống tự giao một việc theo mẫu cho cán bộ. Hạn = ngày lặp + số ngày bên dưới. Hệ thống chạy bù các lần đã qua kể từ ngày bắt đầu và không sinh trùng."
      />
      <Form form={form} layout="vertical" initialValues={{ source: 'CATALOG', frequency: 'MONTHLY', plannedQuantity: 1, dueAfterDays: 14, difficulty: 2 }}>
        <Form.Item name="assigneePersonId" label="Cán bộ nhận việc" rules={[{ required: true, message: 'Chọn cán bộ' }]}>
          <Select showSearch optionFilterProp="label" placeholder="Cấp dưới trực tiếp" options={assigneeOptions(assignees)} />
        </Form.Item>
        <Form.Item name="source" label="Loại việc">
          <Radio.Group
            options={[
              { value: 'CATALOG', label: 'Công việc trong danh mục' },
              { value: 'AD_HOC', label: 'Việc đột xuất' },
            ]}
          />
        </Form.Item>
        {source === 'AD_HOC' ? (
          <>
            <Form.Item name="title" label="Tên việc" rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên việc (từ 3 ký tự)' }]}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="difficulty" label="Mức độ khó" rules={[{ required: true }]}>
              <Select options={AD_HOC_LEVEL_OPTIONS} />
            </Form.Item>
          </>
        ) : (
          <Form.Item name="catalogItemCode" label="Công việc trong danh mục" rules={[{ required: true, message: 'Chọn công việc' }]}>
            <Select showSearch optionFilterProp="label" options={catalogItems.map((i) => ({ value: i.code, label: `${i.code} ${i.name}` }))} />
          </Form.Item>
        )}
        <Space size="large" wrap>
          <Form.Item name="frequency" label="Tần suất" rules={[{ required: true }]}>
            <Select style={{ width: 220 }} options={Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="plannedQuantity" label="Số lượng mỗi lần" rules={[{ required: true }]}>
            <InputNumber min={1} max={100000} precision={0} />
          </Form.Item>
          <Form.Item name="dueAfterDays" label="Hạn sau (ngày)" rules={[{ required: true }]}>
            <InputNumber min={0} max={366} precision={0} />
          </Form.Item>
        </Space>
        <Space size="large" wrap>
          <Form.Item name="startDate" label="Bắt đầu từ" rules={[{ required: true, message: 'Chọn ngày bắt đầu' }]} extra="Lần lặp đầu là ngày đầu chu kỳ kể từ ngày này">
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item name="endDate" label="Kết thúc (không bắt buộc)">
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
        </Space>
        <Form.Item name="note" label="Nội dung việc">
          <Input.TextArea rows={2} maxLength={4000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function RecurringView({ templates, names, tasks, assignees, catalogItems, canAssign }: Props) {
  const { run, busy } = useAction();
  const [creating, setCreating] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  async function generateNow() {
    await run(
      async () => {
        const r = await apiCall<{ templates: number; created: number; errors: { message: string }[] }>('POST', '/tasking/recurring/run');
        setLastRun(r ? `Đã chạy ${r.templates} mẫu, sinh ${r.created} việc${r.errors.length > 0 ? `, ${r.errors.length} lỗi: ${r.errors.map((e) => e.message).join('; ')}` : ''}.` : null);
      },
      { success: 'Đã chạy bộ sinh việc' },
    );
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {canAssign && (
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Tạo mẫu việc lặp
          </Button>
          <Button icon={<PlayCircleOutlined />} loading={busy} onClick={generateNow}>
            Sinh ngay
          </Button>
          <Typography.Text type="secondary">Hệ thống cũng tự chạy mỗi giờ; nút này để sinh ngay khi vừa tạo hoặc sửa mẫu.</Typography.Text>
        </Space>
      )}
      {lastRun && <Alert type="success" showIcon message={lastRun} closable onClose={() => setLastRun(null)} />}
      <Table<RecurringTemplate>
        rowKey="id"
        size="middle"
        pagination={false}
        dataSource={templates}
        locale={{ emptyText: 'Chưa có mẫu việc lặp nào' }}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'Cán bộ', render: (_: unknown, t) => names[t.assigneePersonId] ?? t.assigneePersonId },
          {
            title: 'Việc',
            render: (_: unknown, t) => (
              <>
                {t.source === 'AD_HOC' ? <Tag color="magenta">Đột xuất</Tag> : <strong>{t.catalogItemCode}</strong>} {t.title ?? ''}
                {t.note && <div style={{ color: '#888', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.note}</div>}
              </>
            ),
          },
          { title: 'Tần suất', dataIndex: 'frequency', render: (f: RecurringFrequency) => FREQUENCY_LABELS[f] },
          { title: 'SL / hạn', render: (_: unknown, t) => `${t.plannedQuantity} · sau ${t.dueAfterDays} ngày` },
          { title: 'Hiệu lực', render: (_: unknown, t) => `${dateText(t.startDate)} → ${t.endDate ? dateText(t.endDate) : 'không kết thúc'}` },
          { title: 'Đã sinh', dataIndex: 'generatedCount', align: 'right' as const, width: 90 },
          { title: 'Lần kế tiếp', dataIndex: 'nextOccurrence', render: (d: string | null) => (d ? dateText(d) : '–') },
          {
            title: 'Trạng thái',
            render: (_: unknown, t) => (
              <Space orientation="vertical" size={0}>
                {t.status === 'ACTIVE' ? <Tag color="green">Hoạt động</Tag> : <Tag>Đã ngừng</Tag>}
                {t.lastError && (
                  <Typography.Text type="danger" style={{ maxWidth: 220 }} title={t.lastError}>
                    Lỗi: {t.lastError}
                  </Typography.Text>
                )}
              </Space>
            ),
          },
          {
            title: '',
            width: 130,
            render: (_: unknown, t) =>
              canAssign ? (
                t.status === 'ACTIVE' ? (
                  <Popconfirm
                    title="Ngừng mẫu này?"
                    description="Không sinh thêm việc; các việc đã sinh giữ nguyên."
                    okText="Ngừng"
                    cancelText="Hủy"
                    onConfirm={() => run(async () => void (await apiCall('POST', `/tasking/recurring/${t.id}/deactivate`)), { success: 'Đã ngừng mẫu' })}
                  >
                    <Button size="small" danger loading={busy}>
                      Ngừng
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" loading={busy} onClick={() => run(async () => void (await apiCall('POST', `/tasking/recurring/${t.id}/reactivate`)), { success: 'Đã kích hoạt lại' })}>
                    Kích hoạt lại
                  </Button>
                )
              ) : null,
          },
        ]}
      />
      {creating && <CreateModal assignees={assignees} tasks={tasks} catalogItems={catalogItems} onClose={() => setCreating(false)} />}
    </Space>
  );
}
