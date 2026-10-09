'use client';

import { Alert, Button, Card, DatePicker, Form, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { RoleAssignment } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { dateText, ROLE_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

interface Props {
  accountId: string;
  status: 'ACTIVE' | 'DISABLED';
  linkedPersonId: string | null;
  persons: { personId: string; label: string }[];
  roles: RoleAssignment[];
  permissions: string[];
}

export default function AccountActions({ accountId, status, linkedPersonId, persons, roles, permissions }: Props) {
  const { run, busy } = useAction();
  const can = (p: string) => permissions.includes(p);
  const [linkForm] = Form.useForm<{ person: string }>();
  const [grantForm] = Form.useForm<{ role: string; validTo?: { endOf: (unit: 'day') => { toISOString: () => string } } }>();
  const active = roles.filter((r) => !r.revokedAt);

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {can('account:link-person') && (
        <Card size="small" title="Cán bộ">
          {linkedPersonId ? (
            <Popconfirm
              title="Gỡ liên kết tài khoản với cán bộ này?"
              okText="Gỡ"
              cancelText="Hủy"
              onConfirm={() => run(async () => void (await apiCall('DELETE', `/persons/${linkedPersonId}/account`)), { success: 'Đã gỡ liên kết' })}
            >
              <Button loading={busy}>Gỡ liên kết</Button>
            </Popconfirm>
          ) : (
            <Form
              form={linkForm}
              layout="inline"
              onFinish={(v) => run(async () => void (await apiCall('PUT', `/persons/${v.person}/account`, { accountId })), { success: 'Đã gắn cán bộ' })}
            >
              <Form.Item name="person" rules={[{ required: true, message: 'Chọn cán bộ' }]}>
                <Select
                  showSearch
                  placeholder="Chọn cán bộ"
                  style={{ width: 420 }}
                  optionFilterProp="label"
                  options={persons.map((p) => ({ value: p.personId, label: p.label }))}
                />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={busy}>
                Gắn
              </Button>
            </Form>
          )}
        </Card>
      )}

      <Card size="small" title="Vai trò đang hiệu lực">
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={active}
          locale={{ emptyText: 'Chưa có vai trò nào đang hiệu lực.' }}
          columns={[
            { title: 'Vai trò', dataIndex: 'role', render: (r: string) => <Tag color="blue">{ROLE_LABELS[r] ?? r}</Tag> },
            { title: 'Từ ngày', dataIndex: 'validFrom', render: (d: string) => dateText(d) },
            { title: 'Đến ngày', dataIndex: 'validTo', render: (d: string | null) => (d ? dateText(d) : 'không hết hạn') },
            ...(can('role:assign')
              ? [
                  {
                    title: '',
                    width: 110,
                    render: (_: unknown, r: RoleAssignment) => (
                      <Popconfirm
                        title={`Thu hồi vai trò ${ROLE_LABELS[r.role] ?? r.role}?`}
                        okText="Thu hồi"
                        okButtonProps={{ danger: true }}
                        cancelText="Hủy"
                        onConfirm={() => run(async () => void (await apiCall('DELETE', `/accounts/${accountId}/roles/${r.id}`)), { success: 'Đã thu hồi vai trò' })}
                      >
                        <Button size="small" danger loading={busy}>
                          Thu hồi
                        </Button>
                      </Popconfirm>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      {can('role:assign') && (
        <Card size="small" title="Cấp vai trò">
          <Form
            form={grantForm}
            layout="inline"
            onFinish={(v) =>
              run(
                async () => {
                  await apiCall('POST', `/accounts/${accountId}/roles`, { role: v.role, ...(v.validTo ? { validTo: v.validTo.endOf('day').toISOString() } : {}) });
                  grantForm.resetFields();
                },
                { success: 'Đã cấp vai trò' },
              )
            }
          >
            <Form.Item name="role" rules={[{ required: true, message: 'Chọn vai trò' }]}>
              <Select placeholder="Vai trò" style={{ width: 220 }} options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="validTo">
              <DatePicker placeholder="Hết hạn (tùy chọn)" format="DD/MM/YYYY" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              Cấp
            </Button>
          </Form>
          <Alert style={{ marginTop: 12 }} type="info" showIcon message="Vai trò quản trị phải đứng riêng, không đi cùng vai trò khác, và không được tự cấp cho chính mình." />
        </Card>
      )}

      {can('account:disable') && status === 'ACTIVE' && (
        <Popconfirm
          title="Khóa tài khoản này?"
          description="Các phiên đang đăng nhập sẽ bị chấm dứt."
          okText="Khóa"
          okButtonProps={{ danger: true }}
          cancelText="Hủy"
          onConfirm={() => run(async () => void (await apiCall('POST', `/accounts/${accountId}/disable`)), { success: 'Đã khóa tài khoản' })}
        >
          <Button danger loading={busy}>
            Khóa tài khoản
          </Button>
        </Popconfirm>
      )}
    </Space>
  );
}
