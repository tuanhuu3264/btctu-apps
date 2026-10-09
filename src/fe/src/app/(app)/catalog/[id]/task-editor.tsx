'use client';

import { Form, Input, Modal, Select } from 'antd';
import type { CatalogTask } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

interface Values {
  groupCode?: string;
  name: string;
  description?: string;
}

interface Props {
  versionId: string;
  groups: { code: string; name: string }[];
  /** Có `task` là sửa tên, mô tả; không có là thêm mới vào nhóm. */
  task?: CatalogTask;
  /** Nhóm chọn sẵn khi thêm mới (ví dụ nhóm của tab đang mở). */
  defaultGroup?: string;
  onClose: () => void;
}

/** Hộp thoại thêm hoặc sửa nhiệm vụ của danh mục. Chỉ được dựng khi đang mở nên mỗi lần mở là một form mới. */
export default function TaskEditor({ versionId, groups, task, defaultGroup, onClose }: Props) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<Values>();

  async function submit(v: Values) {
    const ok = await run(
      async () => {
        if (task) {
          await apiCall('PATCH', `/catalog/tasks/${task.id}`, { name: v.name.trim(), description: v.description?.trim() || null });
        } else {
          await apiCall('POST', `/catalog/versions/${versionId}/tasks`, {
            groupCode: v.groupCode,
            name: v.name.trim(),
            ...(v.description?.trim() ? { description: v.description.trim() } : {}),
          });
        }
      },
      { success: task ? 'Đã lưu nhiệm vụ' : 'Đã thêm nhiệm vụ' },
    );
    if (ok) onClose();
  }

  return (
    <Modal title={task ? 'Sửa nhiệm vụ' : 'Thêm nhiệm vụ'} open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy}>
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={task ? { name: task.name, description: task.description ?? undefined } : { groupCode: defaultGroup }}
      >
        {!task && (
          <Form.Item name="groupCode" label="Nhóm" rules={[{ required: true, message: 'Chọn nhóm' }]}>
            <Select placeholder="Chọn nhóm" options={groups.map((g) => ({ value: g.code, label: `Nhóm ${g.code}: ${g.name}` }))} />
          </Form.Item>
        )}
        <Form.Item name="name" label="Tên nhiệm vụ" rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên nhiệm vụ (ít nhất 3 ký tự)' }]}>
          <Input maxLength={200} placeholder="Ví dụ: Công tác quy hoạch cán bộ" autoFocus />
        </Form.Item>
        <Form.Item name="description" label="Mô tả (tùy chọn)">
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
