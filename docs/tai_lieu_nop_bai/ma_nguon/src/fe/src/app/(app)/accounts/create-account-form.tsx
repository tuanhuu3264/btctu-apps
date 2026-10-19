'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal } from 'antd';
import { useState } from 'react';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

export default function CreateAccountForm() {
  const { run, busy, router } = useAction();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ username: string; password: string }>();

  async function submit(v: { username: string; password: string }) {
    await run(
      async () => {
        const created = await apiCall<{ id: string }>('POST', '/accounts', { username: v.username.trim(), password: v.password });
        setOpen(false);
        form.resetFields();
        if (created) router.push(`/accounts/${created.id}`);
      },
      { refresh: false, success: 'Đã tạo tài khoản' },
    );
  }

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        Tạo tài khoản
      </Button>
      <Modal title="Tạo tài khoản" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Tạo" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, whitespace: true, message: 'Nhập tên đăng nhập' }]}>
            <Input autoComplete="off" maxLength={64} />
          </Form.Item>
          <Form.Item
            name="password"
            label="Mật khẩu ban đầu"
            extra="Tối thiểu 12 ký tự. Sau khi tạo, gắn cán bộ và cấp vai trò ở trang chi tiết."
            rules={[{ required: true, message: 'Nhập mật khẩu' }, { min: 12, message: 'Tối thiểu 12 ký tự' }]}
          >
            <Input.Password autoComplete="new-password" maxLength={256} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
