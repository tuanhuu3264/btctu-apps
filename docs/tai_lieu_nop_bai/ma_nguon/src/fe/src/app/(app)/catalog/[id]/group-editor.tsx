'use client';

import { Form, Input, Modal, Select } from 'antd';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

interface Props {
  groups: { code: string; name: string }[];
  /** Có `group` là sửa tên; không có là thêm nhóm mới. */
  group?: { code: string; name: string };
  onClose: () => void;
}

const LETTERS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i));

/**
 * Thêm hoặc sửa tên nhóm công việc (ADR-020). Nhóm dùng chung cho mọi phiên bản. Mã nhóm là một chữ cái; để trống
 * thì máy chủ lấy chữ cái kế tiếp còn trống. Chỉ được dựng khi đang mở nên mỗi lần mở là một form mới.
 */
export default function GroupEditor({ groups, group, onClose }: Props) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ code?: string; name: string }>();
  const free = LETTERS.filter((l) => !groups.some((g) => g.code === l));
  const next = free[0];

  async function submit(v: { code?: string; name: string }) {
    const ok = await run(
      async () => {
        if (group) await apiCall('PATCH', `/catalog/groups/${group.code}`, { name: v.name.trim() });
        else await apiCall('POST', '/catalog/groups', { name: v.name.trim(), ...(v.code ? { code: v.code } : {}) });
      },
      { success: group ? 'Đã đổi tên nhóm' : 'Đã thêm nhóm' },
    );
    if (ok) onClose();
  }

  return (
    <Modal title={group ? `Sửa tên nhóm ${group.code}` : 'Thêm nhóm công việc'} open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={group ? { name: group.name } : undefined}>
        {!group && (
          <Form.Item name="code" label="Mã nhóm" extra={next ? `Để trống thì dùng chữ cái kế tiếp còn trống: ${next}.` : 'Đã dùng hết các chữ cái A–Z.'}>
            <Select allowClear placeholder={next ? `Tự sinh (${next})` : 'Hết mã'} disabled={!next} style={{ width: 200 }} options={free.map((l) => ({ value: l, label: l }))} />
          </Form.Item>
        )}
        <Form.Item
          name="name"
          label="Tên nhóm"
          extra="Nhóm dùng chung cho mọi phiên bản danh mục; đổi tên cũng đổi cách hiển thị ở các phiên bản đã phê duyệt."
          rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên nhóm (ít nhất 3 ký tự)' }]}
        >
          <Input maxLength={255} placeholder="Ví dụ: Nhóm công việc theo vị trí việc làm chuyên trách" autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}
