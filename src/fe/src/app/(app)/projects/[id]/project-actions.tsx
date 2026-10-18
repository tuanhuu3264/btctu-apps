'use client';

import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, RollbackOutlined, SendOutlined, TrophyOutlined } from '@ant-design/icons';
import { Button, DatePicker, Form, Input, Modal, Popconfirm } from 'antd';
import { useState } from 'react';
import type { ProjectDetail } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';
import ProjectFormModal from '../project-form-modal';

type Day = { format: (pattern: string) => string };

/** Hộp nhập lý do (trả lại, hủy). Chỉ được dựng khi đang mở. */
function ReasonModal({ title, okText, danger, onClose, onSubmit }: { title: string; okText: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [form] = Form.useForm<{ reason: string }>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={title}
      okText={okText}
      cancelText="Đóng"
      okButtonProps={{ danger }}
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={async (v) => {
          setBusy(true);
          const ok = await onSubmit(v.reason.trim());
          setBusy(false);
          if (ok) onClose();
        }}
      >
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: 'Nhập lý do' }, { max: 1000, message: 'Tối đa 1000 ký tự' }]}>
          <Input.TextArea rows={4} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Hộp nghiệm thu: ngày nghiệm thu (mặc định hôm nay) và nhận xét. */
function CompleteModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (completedOn: string | undefined, note: string | undefined) => Promise<boolean> }) {
  const [form] = Form.useForm<{ completedOn?: Day; note?: string }>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title="Nghiệm thu" okText="Nghiệm thu" cancelText="Đóng" confirmLoading={busy} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        onFinish={async (v) => {
          setBusy(true);
          const ok = await onSubmit(v.completedOn?.format('YYYY-MM-DD'), v.note?.trim() || undefined);
          setBusy(false);
          if (ok) onClose();
        }}
      >
        <Form.Item name="completedOn" label="Ngày nghiệm thu" extra="Để trống thì lấy ngày hôm nay.">
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="Nhận xét" rules={[{ max: 2000, message: 'Tối đa 2000 ký tự' }]}>
          <Input.TextArea rows={4} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Các nút thao tác theo quyền `can` do máy chủ trả về. */
export default function ProjectActions({ detail, people }: { detail: ProjectDetail; people: { value: string; label: string }[] }) {
  const { run, busy } = useAction();
  const { project, can } = detail;
  const [dialog, setDialog] = useState<'edit' | 'return' | 'complete' | 'cancel' | null>(null);
  const base = `/projects/${project.id}`;
  const close = () => setDialog(null);

  return (
    <>
      {can.edit && (
        <Button icon={<EditOutlined />} onClick={() => setDialog('edit')}>
          Chỉnh sửa
        </Button>
      )}
      {can.submit && (
        <Popconfirm title="Trình duyệt hồ sơ này?" description="Sau khi trình, hồ sơ không sửa được cho đến khi được duyệt hoặc trả lại." okText="Trình duyệt" cancelText="Đóng" onConfirm={() => run(async () => void (await apiCall('POST', `${base}/submit`)), { success: 'Đã trình duyệt' })}>
          <Button type="primary" icon={<SendOutlined />} loading={busy}>
            Trình duyệt
          </Button>
        </Popconfirm>
      )}
      {can.approve && (
        <Popconfirm title="Phê duyệt hồ sơ này?" okText="Phê duyệt" cancelText="Đóng" onConfirm={() => run(async () => void (await apiCall('POST', `${base}/approve`)), { success: 'Đã phê duyệt' })}>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={busy}>
            Phê duyệt
          </Button>
        </Popconfirm>
      )}
      {can.return && (
        <Button icon={<RollbackOutlined />} onClick={() => setDialog('return')}>
          Trả lại
        </Button>
      )}
      {can.complete && (
        <Button type="primary" icon={<TrophyOutlined />} onClick={() => setDialog('complete')}>
          Nghiệm thu
        </Button>
      )}
      {can.cancel && (
        <Button danger icon={<CloseCircleOutlined />} onClick={() => setDialog('cancel')}>
          Hủy
        </Button>
      )}

      {dialog === 'edit' && <ProjectFormModal project={project} people={people} onClose={close} />}
      {dialog === 'return' && (
        <ReasonModal title="Trả lại hồ sơ" okText="Trả lại" onClose={close} onSubmit={(reason) => run(async () => void (await apiCall('POST', `${base}/return`, { reason })), { success: 'Đã trả lại hồ sơ' })} />
      )}
      {dialog === 'cancel' && (
        <ReasonModal title="Hủy đề án, dự án" okText="Hủy đề án, dự án" danger onClose={close} onSubmit={(reason) => run(async () => void (await apiCall('POST', `${base}/cancel`, { reason })), { success: 'Đã hủy' })} />
      )}
      {dialog === 'complete' && (
        <CompleteModal
          onClose={close}
          onSubmit={(completedOn, note) => run(async () => void (await apiCall('POST', `${base}/complete`, { ...(completedOn ? { completedOn } : {}), ...(note ? { note } : {}) })), { success: 'Đã nghiệm thu' })}
        />
      )}
    </>
  );
}
