'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select } from 'antd';
import { useState } from 'react';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

interface Values {
  name: string;
  label: string;
  copy?: string;
}

export default function CreateVersionForm({ versions }: { versions: { id: string; label: string; name: string }[] }) {
  const { run, busy, router } = useAction();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Values>();

  async function submit(values: Values) {
    await run(
      async () => {
        const created = await apiCall<{ id: string }>('POST', '/catalog/versions', {
          name: values.name.trim(),
          label: values.label.trim(),
          ...(values.copy ? { copyFromVersionId: values.copy } : {}),
        });
        setOpen(false);
        form.resetFields();
        if (created) router.push(`/catalog/${created.id}`);
      },
      { refresh: false },
    );
  }

  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        Tạo bản nháp
      </Button>
      <Modal title="Tạo bản nháp danh mục" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Tạo" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="name" label="Tên danh mục" rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập tên danh mục (ít nhất 3 ký tự)' }]}>
            <Input maxLength={200} placeholder="Ví dụ: Danh mục công việc của Ban Tổ chức Tỉnh ủy" />
          </Form.Item>
          <Form.Item name="label" label="Nhãn phiên bản" extra="Mã ngắn, không trùng với phiên bản khác." rules={[{ required: true, whitespace: true, message: 'Nhập nhãn phiên bản' }]}>
            <Input maxLength={120} placeholder="Ví dụ: BTCTU 05.10.2026" />
          </Form.Item>
          <Form.Item name="copy" label="Sao chép từ phiên bản">
            <Select
              allowClear
              placeholder="(bản trống)"
              options={versions.map((v) => ({ value: v.id, label: `${v.name} (${v.label})` }))}
              onChange={(id: string | undefined) => {
                // Chọn bản gốc thì điền sẵn tên của nó nếu chưa nhập, người dùng vẫn sửa được.
                const source = versions.find((v) => v.id === id);
                if (source && !form.getFieldValue('name')) form.setFieldValue('name', source.name);
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
