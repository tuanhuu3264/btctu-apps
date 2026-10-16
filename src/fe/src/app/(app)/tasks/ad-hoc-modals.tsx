'use client';

import { Alert, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd';
import type { AssignmentView, WorkTask } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { AD_HOC_LEVEL_OPTIONS, AD_HOC_TASK_TITLE } from '@/lib/labels';
import { useAction } from '@/lib/use-action';
import { assigneeOptions, positionsOf } from './assign-modal';
import type { Assignee } from './assign-modal';

type DateValue = { format: (pattern: string) => string };

const INFO = 'Việc đột xuất là việc phát sinh ngoài kế hoạch, không có trong danh mục. Theo Nghị định 335/2025 (Điều 18.1.d) việc này được tính ngoài số nhiệm vụ giao ban đầu và được tính thêm điểm kết quả.';

/** Nhiệm vụ "Việc đột xuất" của người nhận: dùng lại nếu có, chưa có thì tạo (nhiệm vụ do cấp trên đặt, ADR-018). */
async function adHocTaskOf(assigneePersonId: string, tasks: WorkTask[]): Promise<string> {
  const same = tasks.find((t) => t.assigneePersonId === assigneePersonId && t.title.trim().toLowerCase() === AD_HOC_TASK_TITLE.toLowerCase());
  if (same) return same.id;
  const created = await apiCall<WorkTask>('POST', '/tasking/tasks', { assigneePersonId, title: AD_HOC_TASK_TITLE });
  if (!created) throw new Error('Không tạo được nhiệm vụ');
  return created.id;
}

/** Cấp trên giao một việc đột xuất cho cấp dưới trực tiếp, chọn mức độ khó (hệ số quy đổi). Chỉ được dựng khi đang mở. */
export function AdHocAssignModal({ assignees, tasks, onClose }: { assignees: Assignee[]; tasks: WorkTask[]; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ assigneePersonId: string; positionId?: string; title: string; difficulty: number; plannedQuantity: number; dueDate: DateValue; note?: string }>();
  const assigneeId = Form.useWatch('assigneePersonId', form);
  const entries = positionsOf(assignees, assigneeId);
  return (
    <Modal
      open
      title="Giao việc đột xuất"
      okText="Giao việc"
      cancelText="Hủy"
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          const ok = await run(
            async () => {
              const taskId = await adHocTaskOf(v.assigneePersonId, tasks);
              await apiCall('POST', '/tasking/assignments', {
                taskId,
                source: 'AD_HOC',
                ...(entries.length > 0 ? { positionId: v.positionId ?? entries[0].positionId } : {}),
                title: v.title.trim(),
                difficulty: v.difficulty,
                plannedQuantity: v.plannedQuantity,
                dueDate: v.dueDate.format('YYYY-MM-DD'),
                periodMode: 'AUTO',
                ...(v.note?.trim() ? { note: v.note.trim() } : {}),
              });
            },
            { success: 'Đã giao việc đột xuất' },
          );
          if (ok) onClose();
        })
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message={INFO} />
      <Form form={form} layout="vertical" initialValues={{ difficulty: 2, plannedQuantity: 1 }}>
        <Form.Item name="assigneePersonId" label="Cán bộ nhận việc" rules={[{ required: true, message: 'Chọn cán bộ' }]}>
          <Select showSearch optionFilterProp="label" placeholder="Cấp dưới trực tiếp" options={assigneeOptions(assignees)} onChange={() => form.setFieldsValue({ positionId: undefined })} />
        </Form.Item>
        {entries.length > 1 && (
          <Form.Item name="positionId" label="Việc thuộc vị trí" rules={[{ required: true, message: 'Chọn vị trí' }]} extra="Cán bộ kiêm nhiệm có phiếu đánh giá riêng cho từng vị trí.">
            <Select placeholder="Chọn vị trí" options={entries.map((a) => ({ value: a.positionId, label: a.label.split(' – ').slice(1).join(' – ') }))} />
          </Form.Item>
        )}
        <Form.Item name="title" label="Tên việc" rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên việc (từ 3 ký tự)' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="difficulty" label="Mức độ khó" extra="Quyết định hệ số quy đổi so với công việc chuẩn." rules={[{ required: true }]}>
          <Select options={AD_HOC_LEVEL_OPTIONS} />
        </Form.Item>
        <Form.Item name="plannedQuantity" label="Số lượng" rules={[{ required: true }]}>
          <InputNumber min={1} max={100000} precision={0} />
        </Form.Item>
        <Form.Item name="dueDate" label="Hạn hoàn thành" rules={[{ required: true, message: 'Chọn hạn' }]}>
          <DatePicker format="DD/MM/YYYY" />
        </Form.Item>
        <Form.Item name="note" label="Nội dung">
          <Input.TextArea rows={3} maxLength={4000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Cán bộ đề xuất một việc đột xuất cho chính mình; cấp trên trực tiếp duyệt và chọn mức độ khó. */
export function ProposeModal({ myPositions, onClose }: { myPositions: { positionId: string; label: string }[]; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ positionId?: string; title: string; difficulty: number; plannedQuantity: number; dueDate: DateValue; note?: string }>();
  return (
    <Modal
      open
      title="Đề xuất việc đột xuất"
      okText="Gửi đề xuất"
      cancelText="Hủy"
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          const ok = await run(
            async () =>
              void (await apiCall('POST', '/tasking/proposals', {
                ...(v.positionId ? { positionId: v.positionId } : {}),
                title: v.title.trim(),
                difficulty: v.difficulty,
                plannedQuantity: v.plannedQuantity,
                dueDate: v.dueDate.format('YYYY-MM-DD'),
                ...(v.note?.trim() ? { note: v.note.trim() } : {}),
              })),
            { success: 'Đã gửi đề xuất cho cấp trên' },
          );
          if (ok) onClose();
        })
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Việc phát sinh ngoài kế hoạch mà bạn đã hoặc sắp làm. Cấp trên trực tiếp duyệt, chọn mức độ khó và số lượng; được duyệt thì mới tính điểm." />
      <Form form={form} layout="vertical" initialValues={{ difficulty: 2, plannedQuantity: 1, positionId: myPositions[0]?.positionId }}>
        {myPositions.length > 1 && (
          <Form.Item name="positionId" label="Việc thuộc vị trí" extra="Bạn kiêm nhiệm nhiều vị trí: cấp trên của vị trí được chọn sẽ duyệt đề xuất, và việc chỉ tính vào phiếu của vị trí đó.">
            <Select options={myPositions.map((p) => ({ value: p.positionId, label: p.label }))} />
          </Form.Item>
        )}
        <Form.Item name="title" label="Tên việc" rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên việc (từ 3 ký tự)' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="difficulty" label="Mức độ khó đề xuất" extra="Cấp trên quyết định mức cuối cùng.">
          <Select options={AD_HOC_LEVEL_OPTIONS} />
        </Form.Item>
        <Form.Item name="plannedQuantity" label="Số lượng" rules={[{ required: true }]}>
          <InputNumber min={1} max={100000} precision={0} />
        </Form.Item>
        <Form.Item name="dueDate" label="Hạn hoàn thành" rules={[{ required: true, message: 'Chọn hạn' }]}>
          <DatePicker format="DD/MM/YYYY" />
        </Form.Item>
        <Form.Item name="note" label="Nội dung">
          <Input.TextArea rows={3} maxLength={4000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Cấp trên duyệt đề xuất: chọn mức độ khó, có thể chỉnh số lượng và hạn. */
export function ApproveProposalModal({ view, onClose, onDone }: { view: AssignmentView; onClose: () => void; onDone: (v: AssignmentView) => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ difficulty: number; plannedQuantity: number }>();
  return (
    <Modal
      open
      title={`Duyệt đề xuất: ${view.itemName}`}
      okText="Duyệt"
      cancelText="Hủy"
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          let result: AssignmentView | null = null;
          const ok = await run(
            async () => {
              result = await apiCall<AssignmentView>('POST', `/tasking/assignments/${view.assignment.id}/proposal/approve`, { difficulty: v.difficulty, plannedQuantity: v.plannedQuantity });
            },
            { success: 'Đã duyệt đề xuất' },
          );
          if (ok) {
            if (result) onDone(result);
            onClose();
          }
        })
      }
    >
      <Form form={form} layout="vertical" initialValues={{ difficulty: view.adHocLevel ?? 2, plannedQuantity: view.assignment.plannedQuantity }}>
        <Form.Item name="difficulty" label="Mức độ khó" rules={[{ required: true }]}>
          <Select options={AD_HOC_LEVEL_OPTIONS} />
        </Form.Item>
        <Form.Item name="plannedQuantity" label="Số lượng" rules={[{ required: true }]}>
          <InputNumber min={1} max={100000} precision={0} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Cấp trên từ chối đề xuất, nêu lý do. */
export function RejectProposalModal({ view, onClose, onDone }: { view: AssignmentView; onClose: () => void; onDone: (v: AssignmentView) => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ reason: string }>();
  return (
    <Modal
      open
      title={`Từ chối đề xuất: ${view.itemName}`}
      okText="Từ chối"
      okButtonProps={{ danger: true }}
      cancelText="Hủy"
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          let result: AssignmentView | null = null;
          const ok = await run(
            async () => {
              result = await apiCall<AssignmentView>('POST', `/tasking/assignments/${view.assignment.id}/proposal/reject`, { reason: v.reason });
            },
            { success: 'Đã từ chối đề xuất' },
          );
          if (ok) {
            if (result) onDone(result);
            onClose();
          }
        })
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, min: 3, message: 'Nêu lý do (từ 3 ký tự)' }]}>
          <Input.TextArea rows={3} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
