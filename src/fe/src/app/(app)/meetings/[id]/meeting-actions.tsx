'use client';

import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, FlagOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { Button, DatePicker, Form, Input, Modal, Select, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import type { MeetingDetail } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';
import MeetingFormModal from '../meeting-form-modal';

type Option = { value: string; label: string };

/** Hộp nhập lý do (từ chối, hủy họp). Chỉ được dựng khi đang mở. */
function ReasonModal({ title, label, okText, danger, onClose, onSubmit }: { title: string; label: string; okText: string; danger?: boolean; onClose: () => void; onSubmit: (reason: string) => Promise<boolean> }) {
  const [form] = Form.useForm<{ reason: string }>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open title={title} okText={okText} cancelText="Đóng" okButtonProps={{ danger }} confirmLoading={busy} onCancel={onClose} onOk={() => form.submit()} destroyOnHidden>
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
        <Form.Item name="reason" label={label} rules={[{ required: true, whitespace: true, message: 'Nhập lý do' }, { min: 3, message: 'Ít nhất 3 ký tự' }, { max: 500, message: 'Tối đa 500 ký tự' }]}>
          <Input.TextArea rows={4} maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface ConcludeValues {
  conclusion: string;
  attendedPersonIds: string[];
  actions?: { content?: string; assigneePersonId?: string; dueDate?: Dayjs }[];
}

/** Hộp kết thúc họp: kết luận, người có mặt (mặc định những người đã xác nhận) và các việc sau họp. */
function ConcludeModal({ detail, onClose }: { detail: MeetingDetail; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<ConcludeValues>();
  const options: Option[] = detail.attendees.map((a) => ({ value: a.personId, label: a.fullName }));

  async function submit(v: ConcludeValues) {
    const actions = (v.actions ?? []).filter((a) => a?.content && a.assigneePersonId && a.dueDate).map((a) => ({ content: a.content!.trim(), assigneePersonId: a.assigneePersonId!, dueDate: a.dueDate!.format('YYYY-MM-DD') }));
    const ok = await run(async () => void (await apiCall('POST', `/meetings/${detail.meeting.id}/conclude`, { conclusion: v.conclusion.trim(), attendedPersonIds: v.attendedPersonIds, actions })), { success: 'Đã kết thúc họp' });
    if (ok) onClose();
  }

  return (
    <Modal open title="Kết thúc họp" okText="Kết thúc họp" cancelText="Đóng" confirmLoading={busy} onOk={() => form.submit()} onCancel={onClose} width={720} style={{ maxWidth: 'calc(100vw - 16px)', top: 24 }} destroyOnHidden>
      <Form<ConcludeValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{ attendedPersonIds: detail.attendees.filter((a) => a.response === 'ACCEPTED').map((a) => a.personId), actions: [] }}
      >
        <Form.Item name="conclusion" label="Kết luận cuộc họp" rules={[{ required: true, whitespace: true, message: 'Nhập kết luận' }, { max: 8000, message: 'Tối đa 8000 ký tự' }]}>
          <Input.TextArea rows={5} maxLength={8000} />
        </Form.Item>
        <Form.Item name="attendedPersonIds" label="Người có mặt" extra="Mặc định là những người đã xác nhận tham dự.">
          <Select mode="multiple" optionFilterProp="label" options={options} placeholder="Chọn người có mặt" />
        </Form.Item>
        <Form.Item label="Việc sau họp">
          <Form.List name="actions">
            {(fields, { add, remove }) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {fields.map((f) => (
                  <div key={f.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start', padding: 8, border: '1px solid #f0f0f0', borderRadius: 6 }}>
                    <Form.Item name={[f.name, 'content']} rules={[{ required: true, whitespace: true, message: 'Nhập nội dung việc' }, { max: 1000, message: 'Tối đa 1000 ký tự' }]} style={{ flex: '1 1 100%', margin: 0 }}>
                      <Input.TextArea rows={2} maxLength={1000} placeholder="Nội dung việc cần làm" />
                    </Form.Item>
                    <Form.Item name={[f.name, 'assigneePersonId']} rules={[{ required: true, message: 'Chọn người thực hiện' }]} style={{ flex: '1 1 220px', margin: 0 }}>
                      <Select showSearch optionFilterProp="label" placeholder="Người thực hiện" options={options} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'dueDate']} rules={[{ required: true, message: 'Chọn hạn' }]} style={{ width: 160, margin: 0 }}>
                      <DatePicker format="DD/MM/YYYY" placeholder="Hạn hoàn thành" style={{ width: '100%' }} />
                    </Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} aria-label="Bỏ việc này" onClick={() => remove(f.name)} />
                  </div>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add()}>
                  Thêm việc sau họp
                </Button>
                <Typography.Text type="secondary">Người thực hiện phải thuộc thành phần cuộc họp.</Typography.Text>
              </div>
            )}
          </Form.List>
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Các nút thao tác theo quyền `can` do máy chủ trả về. */
export default function MeetingActions({ detail, people, myPersonId }: { detail: MeetingDetail; people: Option[]; myPersonId: string }) {
  const { run, busy } = useAction();
  const { meeting, can } = detail;
  const [dialog, setDialog] = useState<'edit' | 'decline' | 'cancel' | 'conclude' | null>(null);
  const base = `/meetings/${meeting.id}`;
  const close = () => setDialog(null);

  return (
    <>
      {can.respond && (
        <>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={busy} disabled={detail.myResponse === 'ACCEPTED'} onClick={() => run(async () => void (await apiCall('POST', `${base}/respond`, { response: 'ACCEPTED' })), { success: 'Đã xác nhận tham dự' })}>
            Xác nhận tham dự
          </Button>
          <Button danger icon={<StopOutlined />} disabled={detail.myResponse === 'DECLINED'} onClick={() => setDialog('decline')}>
            Từ chối
          </Button>
        </>
      )}
      {can.edit && (
        <Button icon={<EditOutlined />} onClick={() => setDialog('edit')}>
          Chỉnh sửa
        </Button>
      )}
      {can.conclude && (
        <Button type="primary" icon={<FlagOutlined />} onClick={() => setDialog('conclude')}>
          Kết thúc họp
        </Button>
      )}
      {can.cancel && (
        <Button danger icon={<CloseCircleOutlined />} onClick={() => setDialog('cancel')}>
          Hủy họp
        </Button>
      )}

      {dialog === 'edit' && <MeetingFormModal detail={detail} people={people} myPersonId={myPersonId} onClose={close} />}
      {dialog === 'decline' && (
        <ReasonModal title="Từ chối tham dự" label="Lý do từ chối" okText="Từ chối" danger onClose={close} onSubmit={(note) => run(async () => void (await apiCall('POST', `${base}/respond`, { response: 'DECLINED', note })), { success: 'Đã từ chối tham dự' })} />
      )}
      {dialog === 'cancel' && (
        <ReasonModal title="Hủy họp" label="Lý do hủy" okText="Hủy họp" danger onClose={close} onSubmit={(reason) => run(async () => void (await apiCall('POST', `${base}/cancel`, { reason })), { success: 'Đã hủy cuộc họp' })} />
      )}
      {dialog === 'conclude' && <ConcludeModal detail={detail} onClose={close} />}
    </>
  );
}
