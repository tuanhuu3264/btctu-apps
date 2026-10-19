'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import type { OrgUnit } from '@/lib/api';
import { apiCall } from '@/lib/client';
import ExportButtons from '@/components/export-buttons';
import ChangeHistoryButton from '@/components/change-history';
import { useAction } from '@/lib/use-action';

interface Values {
  code: string;
  name: string;
  type: 'BAN' | 'PHONG';
  parentId?: string | null;
}

/** Con cháu của một đơn vị: không được chọn làm đơn vị cha của chính nó. */
function descendantIds(units: OrgUnit[], id: string): Set<string> {
  const out = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const u of units) {
      if (u.parentId && out.has(u.parentId) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Hộp thoại thêm hoặc sửa đơn vị. Chỉ được dựng khi đang mở, nên mỗi lần mở là một form mới. */
function UnitFormModal({ unit, units, onClose }: { unit: OrgUnit | null; units: OrgUnit[]; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<Values>();
  const blocked = unit ? descendantIds(units, unit.id) : new Set<string>();

  async function submit(v: Values) {
    const ok = await run(
      async () => {
        if (unit) {
          await apiCall('PATCH', `/units/${unit.id}`, { name: v.name.trim(), type: v.type, parentId: v.parentId ?? null });
        } else {
          await apiCall('POST', '/units', { code: v.code.trim().toUpperCase(), name: v.name.trim(), type: v.type, ...(v.parentId ? { parentId: v.parentId } : {}) });
        }
      },
      { success: unit ? 'Đã lưu đơn vị' : 'Đã thêm đơn vị' },
    );
    if (ok) onClose();
  }

  return (
    <Modal title={unit ? 'Sửa đơn vị' : 'Thêm đơn vị'} open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy}>
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={unit ? { code: unit.code, name: unit.name, type: unit.type, parentId: unit.parentId } : { type: 'PHONG' }}
      >
        <Form.Item name="code" label="Mã đơn vị" rules={[{ required: true, whitespace: true, message: 'Nhập mã' }]} extra={unit ? 'Mã không đổi được.' : undefined}>
          <Input maxLength={32} style={{ width: 200 }} disabled={Boolean(unit)} />
        </Form.Item>
        <Form.Item name="name" label="Tên đơn vị" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}>
          <Input maxLength={255} />
        </Form.Item>
        <Form.Item name="type" label="Loại" rules={[{ required: true }]}>
          <Select options={[{ value: 'BAN', label: 'Ban' }, { value: 'PHONG', label: 'Phòng' }]} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="parentId" label="Thuộc đơn vị">
          <Select allowClear placeholder="(không có)" options={units.filter((u) => u.status === 'ACTIVE' && !blocked.has(u.id)).map((u) => ({ value: u.id, label: u.name }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function UnitsTab({ units, canAudit = false }: { units: OrgUnit[]; canAudit?: boolean }) {
  const { run, busy } = useAction();
  /** undefined: đóng; null: thêm mới; OrgUnit: sửa. */
  const [editing, setEditing] = useState<OrgUnit | null | undefined>(undefined);
  const nameOf = (id: string | null) => units.find((u) => u.id === id)?.name ?? '–';
  const hasActiveChildren = (u: OrgUnit) => units.some((x) => x.parentId === u.id && x.status === 'ACTIVE');
  const hasActivePositions = (u: OrgUnit) => u.positions.some((p) => p.status === 'ACTIVE');
  const parentInactive = (u: OrgUnit) => units.some((x) => x.id === u.parentId && x.status === 'INACTIVE');

  return (
    <>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
          Thêm đơn vị
        </Button>
        <ExportButtons path="/org/export?list=units&includeInactive=true" />
      </Space>
      <Table<OrgUnit>
        rowKey="id"
        pagination={false}
        dataSource={units}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 120 },
          { title: 'Tên đơn vị', dataIndex: 'name' },
          { title: 'Loại', dataIndex: 'type', render: (t: OrgUnit['type']) => (t === 'BAN' ? <Tag color="red">Ban</Tag> : <Tag color="blue">Phòng</Tag>) },
          { title: 'Thuộc', dataIndex: 'parentId', render: (id: string | null) => nameOf(id) },
          { title: 'Số vị trí', render: (_: unknown, u) => u.positions.filter((p) => p.status === 'ACTIVE').length, align: 'right' },
          {
            title: 'Trạng thái',
            dataIndex: 'status',
            width: 130,
            render: (st: OrgUnit['status'], u) => (st === 'ACTIVE' ? <Tag color="green">Hoạt động</Tag> : <Tag color="default" title={u.inactiveReason ?? undefined}>Ngừng sử dụng</Tag>),
          },
          {
            title: '',
            width: 280,
            render: (_: unknown, u) => (
              <Space>
                <ChangeHistoryButton targetType="unit" targetId={u.id} title={u.name} canView={canAudit} />
                <Button size="small" onClick={() => setEditing(u)} disabled={u.status === 'INACTIVE'}>
                  Sửa
                </Button>
                {u.status === 'ACTIVE' ? (
                  <Popconfirm
                    title={`Ngừng sử dụng đơn vị "${u.name}"?`}
                    description="Đơn vị chuyển sang trạng thái ngừng sử dụng (không xóa dữ liệu). Cần ngừng các đơn vị con và vị trí trước."
                    okText="Ngừng sử dụng"
                    okButtonProps={{ danger: true }}
                    cancelText="Hủy"
                    disabled={hasActivePositions(u) || hasActiveChildren(u)}
                    onConfirm={() => run(async () => void (await apiCall('DELETE', `/units/${u.id}`)), { success: 'Đã ngừng sử dụng đơn vị' })}
                  >
                    <Button size="small" danger disabled={hasActivePositions(u) || hasActiveChildren(u)} loading={busy}>
                      Ngừng
                    </Button>
                  </Popconfirm>
                ) : (
                  <Button
                    size="small"
                    disabled={parentInactive(u)}
                    loading={busy}
                    onClick={() => run(async () => void (await apiCall('POST', `/units/${u.id}/reactivate`)), { success: 'Đã kích hoạt lại đơn vị' })}
                  >
                    Kích hoạt lại
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      {editing !== undefined && <UnitFormModal unit={editing} units={units} onClose={() => setEditing(undefined)} />}
    </>
  );
}
