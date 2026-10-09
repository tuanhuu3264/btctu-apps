'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Popconfirm, Space, Table } from 'antd';
import { useState } from 'react';
import type { DocCategory } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { dateText } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

interface Values {
  name: string;
  description?: string;
}

/** Hộp thoại thêm hoặc sửa danh mục. Chỉ được dựng khi đang mở, nên mỗi lần mở là một form mới. */
function CategoryModal({ category, onClose }: { category: DocCategory | null; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<Values>();

  async function submit(v: Values) {
    const body = { name: v.name.trim(), description: v.description?.trim() || undefined };
    const ok = await run(
      async () => {
        await apiCall(category ? 'PATCH' : 'POST', category ? `/documents/categories/${category.id}` : '/documents/categories', body);
      },
      { success: category ? 'Đã lưu danh mục' : 'Đã thêm danh mục' },
    );
    if (ok) onClose();
  }

  return (
    <Modal title={category ? 'Sửa danh mục tài liệu' : 'Thêm danh mục tài liệu'} open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={category ? { name: category.name, description: category.description ?? '' } : {}}>
        <Form.Item name="name" label="Tên danh mục" rules={[{ required: true, whitespace: true, message: 'Nhập tên danh mục' }]}>
          <Input maxLength={120} autoFocus />
        </Form.Item>
        <Form.Item name="description" label="Mô tả">
          <Input.TextArea rows={3} maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function CategoriesTab({ categories }: { categories: DocCategory[] }) {
  const { run, busy } = useAction();
  /** undefined: đóng; null: thêm mới; DocCategory: sửa. */
  const [editing, setEditing] = useState<DocCategory | null | undefined>(undefined);

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
        Thêm danh mục
      </Button>
      <Table
        rowKey="id"
        dataSource={categories}
        pagination={false}
        locale={{ emptyText: 'Chưa có danh mục nào. Hãy tạo danh mục trước khi đăng tài liệu.' }}
        columns={[
          { title: 'Tên danh mục', dataIndex: 'name' },
          { title: 'Mô tả', dataIndex: 'description', render: (d: string | null) => d ?? '–' },
          { title: 'Số bài đang đăng', dataIndex: 'postCount', align: 'right' },
          { title: 'Tạo ngày', dataIndex: 'createdAt', render: (iso: string) => dateText(iso) },
          {
            title: '',
            render: (_: unknown, c: DocCategory) => (
              <Space>
                <Button size="small" onClick={() => setEditing(c)}>
                  Sửa
                </Button>
                <Popconfirm
                  title="Xóa danh mục này?"
                  description="Chỉ xóa được danh mục chưa từng có bài đăng."
                  okText="Xóa"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => run(() => apiCall('DELETE', `/documents/categories/${c.id}`).then(() => undefined), { success: 'Đã xóa danh mục' })}
                >
                  <Button size="small" danger loading={busy}>
                    Xóa
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {editing !== undefined && <CategoryModal category={editing} onClose={() => setEditing(undefined)} />}
    </Space>
  );
}
