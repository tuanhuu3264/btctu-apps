'use client';

import { CheckCircleOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Popconfirm, Select, Space } from 'antd';
import { useState } from 'react';
import type { CatalogTask } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';
import GroupEditor from './group-editor';
import ItemEditor from './item-editor';
import TaskEditor from './task-editor';

interface Props {
  versionId: string;
  versionName: string;
  canManage: boolean;
  canApprove: boolean;
  /** Công việc có thể làm chuẩn: phải có điểm chấm lớn hơn 0. */
  baselineOptions: { code: string; scored: boolean }[];
  baselineCode: string | null;
  groups: { code: string; name: string }[];
  tasks: CatalogTask[];
}

/** Đổi tên danh mục của bản nháp. Chỉ được dựng khi đang mở nên mỗi lần mở là một form mới. */
function RenameModal({ versionId, name, onClose }: { versionId: string; name: string; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ name: string }>();

  async function submit(v: { name: string }) {
    const ok = await run(async () => void (await apiCall('PATCH', `/catalog/versions/${versionId}`, { name: v.name.trim() })), { success: 'Đã đổi tên danh mục' });
    if (ok) onClose();
  }

  return (
    <Modal title="Đổi tên danh mục" open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ name }}>
        <Form.Item name="name" label="Tên danh mục" extra="Nhãn phiên bản không đổi." rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên danh mục (ít nhất 3 ký tự)' }]}>
          <Input maxLength={200} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Thanh thao tác trên bản nháp: đổi tên, thêm nhiệm vụ, thêm công việc (chọn nhiệm vụ trước), đặt công việc chuẩn, phê duyệt. */
export default function VersionActions({ versionId, versionName, canManage, canApprove, baselineOptions, baselineCode, groups, tasks }: Props) {
  const { run, busy } = useAction();
  const [addingTask, setAddingTask] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);

  if (!canManage && !canApprove) return null;

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      {canManage && (
        <>
          <Button icon={<EditOutlined />} onClick={() => setRenaming(true)}>
            Đổi tên danh mục
          </Button>
          {renaming && <RenameModal versionId={versionId} name={versionName} onClose={() => setRenaming(false)} />}
          <Button icon={<PlusOutlined />} onClick={() => setAddingGroup(true)}>
            Thêm nhóm
          </Button>
          {addingGroup && <GroupEditor groups={groups} onClose={() => setAddingGroup(false)} />}
          <Button icon={<PlusOutlined />} onClick={() => setAddingTask(true)}>
            Thêm nhiệm vụ
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddingItem(true)}>
            Thêm công việc
          </Button>
          {addingTask && <TaskEditor versionId={versionId} groups={groups} onClose={() => setAddingTask(false)} />}
          {addingItem && <ItemEditor versionId={versionId} tasks={tasks} groups={groups} onClose={() => setAddingItem(false)} />}
          <Select
            showSearch
            style={{ width: 300 }}
            status={baselineCode ? undefined : 'warning'}
            placeholder="Chọn công việc chuẩn (để tính hệ số)"
            value={baselineCode ?? undefined}
            disabled={busy}
            options={baselineOptions.map((o) => ({ value: o.code, label: o.scored ? o.code : `${o.code} (chưa có điểm)`, disabled: !o.scored }))}
            onChange={(code) => run(async () => void (await apiCall('PUT', `/catalog/versions/${versionId}/baseline`, { itemCode: code })), { success: `Đã đặt ${code} làm công việc chuẩn` })}
          />
        </>
      )}
      {canApprove && (
        <Popconfirm
          title="Phê duyệt phiên bản này?"
          description="Sau khi phê duyệt, phiên bản bị khóa và trở thành danh mục có hiệu lực cho các kỳ đánh giá mới."
          okText="Phê duyệt"
          cancelText="Hủy"
          onConfirm={() => run(async () => void (await apiCall('POST', `/catalog/versions/${versionId}/approve`, {})), { success: 'Đã phê duyệt phiên bản' })}
        >
          <Button icon={<CheckCircleOutlined />} loading={busy}>
            Phê duyệt phiên bản
          </Button>
        </Popconfirm>
      )}
    </Space>
  );
}
