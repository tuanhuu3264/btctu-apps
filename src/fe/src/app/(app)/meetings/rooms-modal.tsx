'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, InputNumber, Modal, Space, Switch, Table, Tag } from 'antd';
import { useState } from 'react';
import type { MeetingRoom } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';
import { useRemote } from '@/lib/use-remote';

interface Values {
  name: string;
  capacity?: number | null;
  description?: string;
}

/**
 * Quản lý danh mục phòng họp (dữ liệu tham chiếu của ô Địa điểm): thêm, sửa tên, sức chứa, ghi chú, ngừng sử dụng.
 * Đổi tên phòng không làm đổi địa điểm của các cuộc họp đã tạo. Chỉ người có quyền meeting:manage-rooms mở được.
 */
export default function RoomsModal({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useRemote<MeetingRoom[]>('/meetings/rooms?includeInactive=true', version);
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<MeetingRoom | 'new' | null>(null);
  const [form] = Form.useForm<Values>();

  const reload = () => setVersion((n) => n + 1);

  function openForm(room: MeetingRoom | 'new') {
    setEditing(room);
    form.setFieldsValue(room === 'new' ? { name: '', capacity: undefined, description: '' } : { name: room.name, capacity: room.capacity, description: room.description ?? '' });
  }

  async function save(v: Values) {
    const body = { name: v.name.trim(), capacity: v.capacity ?? null, description: v.description?.trim() || null };
    const ok = await run(
      async () => {
        await apiCall(editing === 'new' ? 'POST' : 'PATCH', editing === 'new' ? '/meetings/rooms' : `/meetings/rooms/${(editing as MeetingRoom).id}`, body);
      },
      { success: editing === 'new' ? 'Đã thêm phòng họp' : 'Đã lưu phòng họp', refresh: false },
    );
    if (ok) {
      setEditing(null);
      reload();
    }
  }

  async function toggle(room: MeetingRoom, active: boolean) {
    const ok = await run(async () => void (await apiCall('PATCH', `/meetings/rooms/${room.id}`, { status: active ? 'ACTIVE' : 'INACTIVE' })), {
      success: active ? 'Đã dùng lại phòng' : 'Đã ngừng sử dụng phòng',
      refresh: false,
    });
    if (ok) reload();
  }

  return (
    <Modal open title="Phòng họp" footer={null} onCancel={onClose} width={760} style={{ maxWidth: 'calc(100vw - 16px)' }} destroyOnHidden>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="Danh mục này là các lựa chọn của ô Địa điểm khi tạo lịch họp. Đổi tên phòng không làm đổi địa điểm của các cuộc họp đã tạo. Phòng ngừng sử dụng không còn hiện trong ô chọn."
        />
        {error && <Alert type="error" showIcon message={error} />}
        <div style={{ textAlign: 'right' }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm('new')}>
            Thêm phòng họp
          </Button>
        </div>
        <Table<MeetingRoom>
          size="small"
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={data ?? []}
          scroll={{ x: 560 }}
          columns={[
            { title: 'Tên phòng', dataIndex: 'name', render: (n: string, r) => <span style={r.status === 'INACTIVE' ? { color: '#999' } : undefined}>{n}</span> },
            { title: 'Sức chứa', dataIndex: 'capacity', align: 'right', width: 90, render: (c: number | null) => c ?? '–' },
            { title: 'Ghi chú', dataIndex: 'description', render: (d: string | null) => d ?? '–' },
            { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (s: MeetingRoom['status']) => (s === 'ACTIVE' ? <Tag color="green">Đang dùng</Tag> : <Tag>Ngừng sử dụng</Tag>) },
            {
              title: '',
              width: 170,
              render: (_, r) => (
                <Space size="small">
                  <Button size="small" onClick={() => openForm(r)}>
                    Sửa
                  </Button>
                  <Switch size="small" checked={r.status === 'ACTIVE'} onChange={(v) => void toggle(r, v)} aria-label={r.status === 'ACTIVE' ? 'Ngừng sử dụng' : 'Dùng lại'} />
                </Space>
              ),
            },
          ]}
        />
      </Space>
      <Modal open={editing !== null} title={editing === 'new' ? 'Thêm phòng họp' : 'Sửa phòng họp'} okText="Lưu" cancelText="Hủy" confirmLoading={busy} onOk={() => form.submit()} onCancel={() => setEditing(null)} destroyOnHidden forceRender>
        <Form<Values> form={form} layout="vertical" onFinish={save} requiredMark={false}>
          <Form.Item name="name" label="Tên phòng" rules={[{ required: true, whitespace: true, message: 'Nhập tên phòng' }, { min: 2, message: 'Tối thiểu 2 ký tự' }, { max: 100, message: 'Tối đa 100 ký tự' }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="capacity" label="Sức chứa (số chỗ)">
            <InputNumber min={1} max={10000} precision={0} style={{ width: '100%' }} placeholder="Chưa ghi" />
          </Form.Item>
          <Form.Item name="description" label="Ghi chú" rules={[{ max: 500, message: 'Tối đa 500 ký tự' }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
}
