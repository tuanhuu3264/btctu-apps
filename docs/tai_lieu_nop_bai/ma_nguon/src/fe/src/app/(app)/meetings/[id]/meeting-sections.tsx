'use client';

import { CheckOutlined, DeleteOutlined, EditOutlined, PaperClipOutlined, PlusOutlined, UndoOutlined } from '@ant-design/icons';
import { App, Button, Card, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import FileLink from '@/components/file-link';
import type { MeetingAction, MeetingAttachment, MeetingAttendee, MeetingDetail } from '@/lib/api';
import { API_URL, apiCall, apiUpload } from '@/lib/client';
import { dateTimeText, dmyText, fileSizeText, MEETING_RESPONSE_COLORS, MEETING_RESPONSE_LABELS, MEETING_ROLE_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

// ---- Thành phần

function AttendeesCard({ detail }: { detail: MeetingDetail }) {
  const held = detail.meeting.status === 'HELD';
  return (
    <Card size="small" title={`Thành phần (${detail.attendees.length})`}>
      <Table<MeetingAttendee>
        rowKey="personId"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={detail.attendees}
        columns={[
          { title: 'Họ tên', dataIndex: 'fullName' },
          { title: 'Vai trò', render: (_: unknown, a) => (a.role === 'ORGANIZER' ? <Tag color="red">{MEETING_ROLE_LABELS.ORGANIZER}</Tag> : <Tag>{MEETING_ROLE_LABELS[a.role]}</Tag>) },
          { title: 'Trả lời', render: (_: unknown, a) => <Tag color={MEETING_RESPONSE_COLORS[a.response]}>{MEETING_RESPONSE_LABELS[a.response]}</Tag> },
          { title: 'Ghi chú', render: (_: unknown, a) => a.note ?? '–' },
          ...(held ? [{ title: 'Có mặt', render: (_: unknown, a: MeetingAttendee) => (a.attended === null ? '–' : a.attended ? <Tag color="green">Có mặt</Tag> : <Tag>Vắng</Tag>) }] : []),
        ]}
      />
    </Card>
  );
}

// ---- Kết luận

function ConclusionCard({ detail }: { detail: MeetingDetail }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ conclusion: string }>();
  const [editing, setEditing] = useState(false);
  const m = detail.meeting;

  return (
    <Card size="small" title="Kết luận cuộc họp" extra={detail.can.manageActions && <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(true)}>Sửa kết luận</Button>}>
      <span style={{ whiteSpace: 'pre-wrap' }}>{m.conclusion ?? '–'}</span>
      {editing && (
        <Modal
          open
          title="Sửa kết luận"
          okText="Lưu"
          cancelText="Đóng"
          confirmLoading={busy}
          onOk={() => form.submit()}
          onCancel={() => setEditing(false)}
          width={640}
          destroyOnHidden
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={{ conclusion: m.conclusion ?? '' }}
            onFinish={async (v) => {
              const ok = await run(async () => void (await apiCall('PATCH', `/meetings/${m.id}/conclusion`, { conclusion: v.conclusion.trim() })), { success: 'Đã lưu kết luận' });
              if (ok) setEditing(false);
            }}
          >
            <Form.Item name="conclusion" label="Kết luận" rules={[{ required: true, whitespace: true, message: 'Nhập kết luận' }, { max: 8000, message: 'Tối đa 8000 ký tự' }]}>
              <Input.TextArea rows={7} maxLength={8000} />
            </Form.Item>
          </Form>
        </Modal>
      )}
    </Card>
  );
}

// ---- Việc sau họp

interface ActionValues {
  content: string;
  assigneePersonId: string;
  dueDate: Dayjs;
}

/** Hộp thêm hoặc sửa một việc sau họp. Chỉ được dựng khi đang mở. */
function ActionModal({ detail, action, onClose }: { detail: MeetingDetail; action?: MeetingAction; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<ActionValues>();
  const options = detail.attendees.map((a) => ({ value: a.personId, label: a.fullName }));
  const base = `/meetings/${detail.meeting.id}/actions`;

  async function submit(v: ActionValues) {
    const body = { content: v.content.trim(), assigneePersonId: v.assigneePersonId, dueDate: v.dueDate.format('YYYY-MM-DD') };
    const ok = await run(async () => void (await apiCall(action ? 'PATCH' : 'POST', action ? `${base}/${action.id}` : base, body)), { success: action ? 'Đã lưu việc' : 'Đã thêm việc sau họp' });
    if (ok) onClose();
  }

  return (
    <Modal open title={action ? 'Sửa việc sau họp' : 'Thêm việc sau họp'} okText="Lưu" cancelText="Đóng" confirmLoading={busy} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <Form<ActionValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={action ? { content: action.content, assigneePersonId: action.assigneePersonId, dueDate: dayjs(action.dueDate) } : undefined}
      >
        <Form.Item name="content" label="Nội dung" rules={[{ required: true, whitespace: true, message: 'Nhập nội dung việc' }, { max: 1000, message: 'Tối đa 1000 ký tự' }]}>
          <Input.TextArea rows={3} maxLength={1000} />
        </Form.Item>
        <Form.Item name="assigneePersonId" label="Người thực hiện" rules={[{ required: true, message: 'Chọn người thực hiện' }]} extra="Chọn trong thành phần cuộc họp.">
          <Select showSearch optionFilterProp="label" options={options} />
        </Form.Item>
        <Form.Item name="dueDate" label="Hạn hoàn thành" rules={[{ required: true, message: 'Chọn hạn' }]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ActionsCard({ detail, myPersonId }: { detail: MeetingDetail; myPersonId: string | null }) {
  const { run, busy } = useAction();
  const [dialog, setDialog] = useState<{ action?: MeetingAction } | null>(null);
  const manage = detail.can.manageActions;
  const base = `/meetings/${detail.meeting.id}/actions`;

  return (
    <Card
      size="small"
      title={`Việc sau họp (${detail.actions.length})`}
      extra={
        manage && (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setDialog({})}>
            Thêm việc
          </Button>
        )
      }
    >
      <Table<MeetingAction>
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={detail.actions}
        locale={{ emptyText: 'Chưa có việc sau họp nào' }}
        columns={[
          { title: 'Nội dung', render: (_: unknown, a) => <span style={{ display: 'inline-block', minWidth: 200, maxWidth: 420, whiteSpace: 'pre-wrap' }}>{a.content}</span> },
          { title: 'Người thực hiện', dataIndex: 'assigneeName' },
          { title: 'Hạn', render: (_: unknown, a) => (a.overdue ? <Typography.Text type="danger" strong>{dmyText(a.dueDate)}</Typography.Text> : dmyText(a.dueDate)) },
          {
            title: 'Trạng thái',
            render: (_: unknown, a) => (a.status === 'DONE' ? <Tag color="green">Đã xong{a.completedOn ? ` ${dmyText(a.completedOn)}` : ''}</Tag> : a.overdue ? <Tag color="red">Quá hạn</Tag> : <Tag color="blue">Chưa xong</Tag>),
          },
          {
            title: '',
            render: (_: unknown, a) => (
              <Space size={4} wrap>
                {a.status === 'PENDING' && (manage || (myPersonId !== null && myPersonId === a.assigneePersonId)) && (
                  <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy} onClick={() => run(async () => void (await apiCall('POST', `${base}/${a.id}/done`)), { success: 'Đã đánh dấu xong' })}>
                    Đã xong
                  </Button>
                )}
                {a.status === 'DONE' && manage && (
                  <Button size="small" icon={<UndoOutlined />} loading={busy} onClick={() => run(async () => void (await apiCall('POST', `${base}/${a.id}/reopen`)), { success: 'Đã mở lại' })}>
                    Mở lại
                  </Button>
                )}
                {manage && (
                  <>
                    <Button size="small" icon={<EditOutlined />} aria-label="Sửa việc" onClick={() => setDialog({ action: a })} />
                    <Popconfirm title="Xóa việc này?" okText="Xóa" cancelText="Đóng" okButtonProps={{ danger: true }} onConfirm={() => run(async () => void (await apiCall('DELETE', `${base}/${a.id}`)), { success: 'Đã xóa việc' })}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label="Xóa việc" />
                    </Popconfirm>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      {dialog && <ActionModal detail={detail} action={dialog.action} onClose={() => setDialog(null)} />}
    </Card>
  );
}

// ---- Biên bản đính kèm

function AttachmentsCard({ detail }: { detail: MeetingDetail }) {
  const { message } = App.useApp();
  const { run } = useAction();
  const [file, setFile] = useState<UploadFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const id = detail.meeting.id;

  async function upload() {
    if (!file) return;
    setUploading(true);
    const ok = await run(async () => void (await apiUpload(`/meetings/${id}/attachments`, file as unknown as File)), { success: 'Đã tải lên' });
    setUploading(false);
    if (ok) setFile(null);
  }

  return (
    <Card size="small" title={`Biên bản đính kèm (${detail.attachments.length})`}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {detail.can.upload && (
          <>
            <Space wrap>
              <Upload
                accept={ACCEPT}
                maxCount={1}
                fileList={file ? [file] : []}
                beforeUpload={(f: UploadFile & File) => {
                  if (f.size > MAX_FILE_BYTES) {
                    message.error(`${f.name}: tệp tối đa 20 MB`);
                    return Upload.LIST_IGNORE;
                  }
                  setFile(f);
                  return false;
                }}
                onRemove={() => setFile(null)}
              >
                <Button icon={<PaperClipOutlined />}>Chọn tệp</Button>
              </Upload>
              <Button type="primary" loading={uploading} disabled={!file} onClick={upload}>
                Tải lên
              </Button>
            </Space>
            <Typography.Text type="secondary">Tối đa 20 MB mỗi tệp, 20 tệp mỗi cuộc họp. Nhận pdf, Word, Excel, PowerPoint, txt, csv, png, jpg. Tệp không sửa, không xóa được.</Typography.Text>
          </>
        )}
        <Table<MeetingAttachment>
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={detail.attachments}
          locale={{ emptyText: 'Chưa có tệp nào' }}
          columns={[
            { title: 'Tên tệp', render: (_: unknown, a) => <FileLink compact url={`${API_URL}/meetings/${id}/attachments/${a.id}`} fileName={a.fileName} contentType={a.contentType} /> },
            { title: 'Cỡ', align: 'right', render: (_: unknown, a) => fileSizeText(a.sizeBytes) },
            { title: 'Tải lên lúc', render: (_: unknown, a) => dateTimeText(a.createdAt) },
          ]}
        />
      </Space>
    </Card>
  );
}

/** Thành phần, kết luận, việc sau họp và biên bản đính kèm của một cuộc họp. */
export default function MeetingSections({ detail, myPersonId }: { detail: MeetingDetail; myPersonId: string | null }) {
  const held = detail.meeting.status === 'HELD';
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <AttendeesCard detail={detail} />
      {held && <ConclusionCard detail={detail} />}
      {held && <ActionsCard detail={detail} myPersonId={myPersonId} />}
      <AttachmentsCard detail={detail} />
    </Space>
  );
}
