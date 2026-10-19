'use client';

import { DatePicker, Form, Input, Modal, Select } from 'antd';
import dayjs from 'dayjs';
import type { Project } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { PROJECT_KIND_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

type Day = { format: (pattern: string) => string };

interface Values {
  kind: 'DE_AN' | 'DU_AN';
  title: string;
  objective?: string;
  description?: string;
  ownerPersonId?: string;
  range: [Day, Day];
}

interface Props {
  /** Có `project` là sửa hồ sơ; không có là lập mới. */
  project?: Project;
  /** Cán bộ chọn làm chủ trì. */
  people: { value: string; label: string }[];
  onClose: () => void;
  /** Gọi sau khi lập mới thành công, kèm mã đề án vừa tạo. */
  onCreated?: (id: string) => void;
}

/** Form lập mới hoặc sửa hồ sơ đề án, dự án. Chỉ được dựng khi đang mở nên mỗi lần mở là một form mới. */
export default function ProjectFormModal({ project, people, onClose, onCreated }: Props) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<Values>();

  async function submit(v: Values) {
    const body = {
      title: v.title.trim(),
      objective: v.objective?.trim() || null,
      description: v.description?.trim() || null,
      ...(v.ownerPersonId ? { ownerPersonId: v.ownerPersonId } : {}),
      startDate: v.range[0].format('YYYY-MM-DD'),
      endDate: v.range[1].format('YYYY-MM-DD'),
    };
    const ok = await run(
      async () => {
        if (project) await apiCall('PATCH', `/projects/${project.id}`, body);
        else {
          const created = await apiCall<Project>('POST', '/projects', { kind: v.kind, ...body });
          if (created && onCreated) onCreated(created.id);
        }
      },
      { success: project ? 'Đã lưu hồ sơ' : 'Đã lập hồ sơ (đang soạn)', refresh: Boolean(project) },
    );
    if (ok) onClose();
  }

  return (
    <Modal
      open
      title={project ? `Chỉnh sửa ${project.code}` : 'Lập đề án, dự án'}
      okText={project ? 'Lưu' : 'Lập hồ sơ'}
      cancelText="Hủy"
      confirmLoading={busy}
      onOk={() => form.submit()}
      onCancel={onClose}
      width={640}
      destroyOnHidden
    >
      <Form<Values>
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={
          project
            ? {
                kind: project.kind,
                title: project.title,
                objective: project.objective ?? undefined,
                description: project.description ?? undefined,
                ownerPersonId: project.ownerPersonId,
                range: [dayjs(project.startDate), dayjs(project.endDate)],
              }
            : { kind: 'DE_AN' }
        }
      >
        {!project && (
          <Form.Item name="kind" label="Loại" rules={[{ required: true }]}>
            <Select options={(Object.keys(PROJECT_KIND_LABELS) as (keyof typeof PROJECT_KIND_LABELS)[]).map((k) => ({ value: k, label: PROJECT_KIND_LABELS[k] }))} />
          </Form.Item>
        )}
        <Form.Item name="title" label="Tên" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }, { max: 200, message: 'Tối đa 200 ký tự' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="objective" label="Mục tiêu" rules={[{ max: 4000, message: 'Tối đa 4000 ký tự' }]}>
          <Input.TextArea rows={3} maxLength={4000} />
        </Form.Item>
        <Form.Item name="description" label="Nội dung" rules={[{ max: 8000, message: 'Tối đa 8000 ký tự' }]}>
          <Input.TextArea rows={4} maxLength={8000} />
        </Form.Item>
        <Form.Item name="ownerPersonId" label="Chủ trì" extra={project ? undefined : 'Để trống thì bạn là chủ trì.'}>
          <Select showSearch allowClear={!project} optionFilterProp="label" placeholder="Chọn cán bộ chủ trì" options={people} />
        </Form.Item>
        <Form.Item name="range" label="Thời gian thực hiện" rules={[{ required: true, message: 'Chọn ngày bắt đầu và kết thúc' }]}>
          <DatePicker.RangePicker format="DD/MM/YYYY" placeholder={['Bắt đầu', 'Kết thúc']} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
