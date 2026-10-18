'use client';

import { DeleteOutlined, DisconnectOutlined, LinkOutlined, PaperClipOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import FileLink from '@/components/file-link';
import type { MeetingRow, ProjectAttachment, ProjectDetail, ProjectMilestone, ProjectWork } from '@/lib/api';
import { API_URL, apiCall, apiGet, apiUpload } from '@/lib/client';
import { dateTimeText, dmyText, fileSizeText, MEETING_STATUS_COLORS, MEETING_STATUS_LABELS, meetingRangeText, STATE_COLORS, STATE_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';
import { useRemote } from '@/lib/use-remote';
import MeetingFormModal from '../../meetings/meeting-form-modal';

type Day = { format: (pattern: string) => string };
type Option = { value: string; label: string };

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg';
const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface Props {
  detail: ProjectDetail;
  /** Cán bộ chọn được (từ sơ đồ tổ chức); trống thì chỉ chọn trong số thành viên. */
  people: Option[];
  myPersonId: string | null;
  /** Có quyền xem mọi cuộc họp (meeting:read-all). */
  canReadAllMeetings?: boolean;
}

// ---- Thành viên

function MembersCard({ detail, people }: { detail: ProjectDetail; people: Option[] }) {
  const { run, busy } = useAction();
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const memberIds = new Set(detail.members.map((m) => m.personId));
  const base = `/projects/${detail.project.id}`;
  const canEdit = detail.can.edit;

  return (
    <Card size="small" title={`Thành viên (${detail.members.length})`}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Space size={[4, 8]} wrap>
          {detail.members.length === 0 && <Typography.Text type="secondary">Chưa có thành viên.</Typography.Text>}
          {detail.members.map((m) => (
            <Tag
              key={m.personId}
              color={m.role === 'LEAD' ? 'red' : undefined}
              closable={canEdit && m.role !== 'LEAD'}
              onClose={(e) => {
                e.preventDefault();
                Modal.confirm({
                  title: `Bớt ${m.fullName} khỏi thành viên?`,
                  okText: 'Bớt',
                  cancelText: 'Đóng',
                  onOk: () => run(async () => void (await apiCall('DELETE', `${base}/members/${m.personId}`)), { success: 'Đã bớt thành viên' }),
                });
              }}
            >
              {m.fullName}
              {m.role === 'LEAD' ? ' (chủ trì)' : ''}
            </Tag>
          ))}
        </Space>
        {canEdit && people.length > 0 && (
          <Space wrap>
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              placeholder="Chọn cán bộ để thêm"
              style={{ width: 340, maxWidth: '100%' }}
              value={picked}
              onChange={setPicked}
              options={people.filter((p) => !memberIds.has(p.value))}
            />
            <Button
              icon={<PlusOutlined />}
              disabled={!picked}
              loading={busy}
              onClick={async () => {
                if (await run(async () => void (await apiCall('POST', `${base}/members`, { personId: picked })), { success: 'Đã thêm thành viên' })) setPicked(undefined);
              }}
            >
              Thêm
            </Button>
          </Space>
        )}
      </Space>
    </Card>
  );
}

// ---- Mốc tiến độ

interface MilestoneValues {
  title: string;
  dueDate: Day;
  weight: number;
  assigneePersonId?: string;
  note?: string;
}

function MilestoneModal({ projectId, milestone, options, onClose }: { projectId: string; milestone?: ProjectMilestone; options: Option[]; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<MilestoneValues>();

  async function submit(v: MilestoneValues) {
    const body = {
      title: v.title.trim(),
      dueDate: v.dueDate.format('YYYY-MM-DD'),
      weight: v.weight,
      assigneePersonId: v.assigneePersonId ?? null,
      note: v.note?.trim() || null,
    };
    const ok = await run(
      async () => {
        if (milestone) await apiCall('PATCH', `/projects/${projectId}/milestones/${milestone.id}`, body);
        else await apiCall('POST', `/projects/${projectId}/milestones`, body);
      },
      { success: milestone ? 'Đã lưu mốc' : 'Đã thêm mốc' },
    );
    if (ok) onClose();
  }

  return (
    <Modal open title={milestone ? 'Sửa mốc tiến độ' : 'Thêm mốc tiến độ'} okText="Lưu" cancelText="Đóng" confirmLoading={busy} onOk={() => form.submit()} onCancel={onClose} destroyOnHidden>
      <Form<MilestoneValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={
          milestone
            ? { title: milestone.title, dueDate: dayjs(milestone.dueDate), weight: milestone.weight, assigneePersonId: milestone.assigneePersonId ?? undefined, note: milestone.note ?? undefined }
            : { weight: 1 }
        }
      >
        <Form.Item name="title" label="Tên mốc" rules={[{ required: true, whitespace: true, message: 'Nhập tên mốc' }, { max: 200, message: 'Tối đa 200 ký tự' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="dueDate" label="Hạn" rules={[{ required: true, message: 'Chọn hạn' }]}>
          <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="weight" label="Trọng số" extra="Số nguyên từ 1 đến 100, dùng để tính phần trăm tiến độ." rules={[{ required: true, message: 'Nhập trọng số' }]}>
          <InputNumber min={1} max={100} precision={0} style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="assigneePersonId" label="Người phụ trách" extra="Để trống thì chủ trì phụ trách.">
          <Select showSearch allowClear optionFilterProp="label" placeholder="Chọn cán bộ" options={options} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú" rules={[{ max: 1000, message: 'Tối đa 1000 ký tự' }]}>
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function MilestonesCard({ detail, options, myPersonId }: { detail: ProjectDetail; options: Option[]; myPersonId: string | null }) {
  const { run, busy } = useAction();
  const [editing, setEditing] = useState<ProjectMilestone | 'new' | null>(null);
  const { project, can } = detail;
  const base = `/projects/${project.id}/milestones`;
  const active = project.status === 'ACTIVE';

  return (
    <Card
      size="small"
      title={`Mốc tiến độ (${detail.milestones.length})`}
      extra={
        can.manageMilestones && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            Thêm mốc
          </Button>
        )
      }
    >
      <Table<ProjectMilestone>
        rowKey="id"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={detail.milestones}
        locale={{ emptyText: 'Chưa có mốc tiến độ nào' }}
        columns={[
          {
            title: 'Mốc',
            render: (_: unknown, m) => (
              <div style={{ minWidth: 180 }}>
                {m.title}
                {m.note && <div style={{ color: '#888', fontSize: 12 }}>{m.note}</div>}
              </div>
            ),
          },
          { title: 'Hạn', render: (_: unknown, m) => <span style={m.overdue ? { color: '#cf1322', fontWeight: 600 } : undefined}>{dmyText(m.dueDate)}</span> },
          { title: 'Trọng số', dataIndex: 'weight', align: 'right' },
          { title: 'Phụ trách', render: (_: unknown, m) => m.assigneeName ?? detail.ownerName },
          {
            title: 'Trạng thái',
            render: (_: unknown, m) =>
              m.status === 'DONE' ? <Tag color="green">Đã xong{m.completedOn ? ` ${dmyText(m.completedOn)}` : ''}</Tag> : m.overdue ? <Tag color="red">Quá hạn</Tag> : <Tag>Chưa xong</Tag>,
          },
          {
            title: '',
            render: (_: unknown, m) => (
              <Space size={4} wrap>
                {m.status !== 'DONE' && active && (can.edit || (myPersonId !== null && m.assigneePersonId === myPersonId)) && (
                  <Popconfirm title="Đánh dấu mốc này đã xong?" okText="Đã xong" cancelText="Đóng" onConfirm={() => run(async () => void (await apiCall('POST', `${base}/${m.id}/done`, {})), { success: 'Đã đánh dấu xong' })}>
                    <Button size="small" type="primary" loading={busy}>
                      Đã xong
                    </Button>
                  </Popconfirm>
                )}
                {m.status === 'DONE' && can.edit && (
                  <Button size="small" loading={busy} onClick={() => run(async () => void (await apiCall('POST', `${base}/${m.id}/reopen`)), { success: 'Đã mở lại mốc' })}>
                    Mở lại
                  </Button>
                )}
                {can.manageMilestones && (
                  <>
                    <Button size="small" onClick={() => setEditing(m)}>
                      Sửa
                    </Button>
                    <Popconfirm title="Xóa mốc này?" okText="Xóa" okButtonProps={{ danger: true }} cancelText="Đóng" onConfirm={() => run(async () => void (await apiCall('DELETE', `${base}/${m.id}`)), { success: 'Đã xóa mốc' })}>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Xóa mốc ${m.title}`} />
                    </Popconfirm>
                  </>
                )}
              </Space>
            ),
          },
        ]}
      />
      {editing && <MilestoneModal projectId={project.id} milestone={editing === 'new' ? undefined : editing} options={options} onClose={() => setEditing(null)} />}
    </Card>
  );
}

// ---- Việc được giao gắn vào

function LinkWorkModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { run, busy } = useAction();
  const [candidates, setCandidates] = useState<ProjectWork[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    apiGet<ProjectWork[]>(`/projects/${projectId}/link-candidates`)
      .then((c) => !cancelled && setCandidates(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <Modal
      open
      title="Gắn việc vào đề án, dự án"
      okText="Gắn việc"
      cancelText="Đóng"
      okButtonProps={{ disabled: !picked }}
      confirmLoading={busy}
      onCancel={onClose}
      onOk={async () => {
        if (await run(async () => void (await apiCall('POST', `/projects/${projectId}/work`, { assignmentId: picked })), { success: 'Đã gắn việc' })) onClose();
      }}
      destroyOnHidden
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Select
        showSearch
        optionFilterProp="label"
        loading={!candidates && !error}
        placeholder="Chọn việc bạn đã giao"
        style={{ width: '100%' }}
        value={picked}
        onChange={setPicked}
        notFoundContent="Không còn việc nào để gắn"
        options={(candidates ?? []).map((c) => ({ value: c.assignmentId, label: `${c.title} – ${c.taskTitle} (hạn ${dmyText(c.dueDate)})` }))}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        Chỉ hiện các việc bạn đã giao, còn hiệu lực và chưa gắn vào đề án nào.
      </Typography.Paragraph>
    </Modal>
  );
}

function WorkCard({ detail }: { detail: ProjectDetail }) {
  const { run, busy } = useAction();
  const [linking, setLinking] = useState(false);
  const { project, can } = detail;
  const stateTag = (s: string) => {
    const key = s as keyof typeof STATE_LABELS;
    return <Tag color={STATE_COLORS[key] ?? 'default'}>{STATE_LABELS[key] ?? s}</Tag>;
  };

  return (
    <Card
      size="small"
      title={`Việc được giao gắn vào (${detail.work.length})`}
      extra={
        can.link && (
          <Button size="small" icon={<LinkOutlined />} onClick={() => setLinking(true)}>
            Gắn việc
          </Button>
        )
      }
    >
      <Table<ProjectDetail['work'][number]>
        rowKey="assignmentId"
        size="small"
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={detail.work}
        locale={{ emptyText: 'Chưa có việc nào gắn vào' }}
        columns={[
          { title: 'Việc', render: (_: unknown, w) => <div style={{ minWidth: 180 }}>{w.title}</div> },
          { title: 'Nhiệm vụ', dataIndex: 'taskTitle' },
          { title: 'Người nhận', dataIndex: 'assigneeName' },
          { title: 'Hạn', render: (_: unknown, w) => dmyText(w.dueDate) },
          { title: 'Trạng thái', render: (_: unknown, w) => stateTag(w.state) },
          { title: 'Đã xác nhận / giao', align: 'right', render: (_: unknown, w) => `${w.confirmedQuantity}/${w.plannedQuantity}` },
          ...(can.link
            ? [
                {
                  title: '',
                  render: (_: unknown, w: ProjectDetail['work'][number]) => (
                    <Popconfirm title="Gỡ việc này khỏi đề án, dự án?" okText="Gỡ" cancelText="Đóng" onConfirm={() => run(async () => void (await apiCall('DELETE', `/projects/${project.id}/work/${w.assignmentId}`)), { success: 'Đã gỡ việc' })}>
                      <Button size="small" icon={<DisconnectOutlined />} loading={busy}>
                        Gỡ
                      </Button>
                    </Popconfirm>
                  ),
                },
              ]
            : []),
        ]}
      />
      {linking && <LinkWorkModal projectId={project.id} onClose={() => setLinking(false)} />}
    </Card>
  );
}

// ---- Tài liệu

function AttachmentsCard({ detail }: { detail: ProjectDetail }) {
  const { message } = App.useApp();
  const { run } = useAction();
  const [file, setFile] = useState<UploadFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const id = detail.project.id;

  async function upload() {
    if (!file) return;
    setUploading(true);
    const ok = await run(async () => void (await apiUpload(`/projects/${id}/attachments`, file as unknown as File)), { success: 'Đã tải lên' });
    setUploading(false);
    if (ok) setFile(null);
  }

  return (
    <Card size="small" title={`Tài liệu (${detail.attachments.length})`}>
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
            <Typography.Text type="secondary">Tối đa 20 MB mỗi tệp, 30 tệp mỗi đề án. Nhận pdf, Word, Excel, PowerPoint, txt, csv, png, jpg. Tệp không sửa, không xóa được.</Typography.Text>
          </>
        )}
        <Table<ProjectAttachment>
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={detail.attachments}
          locale={{ emptyText: 'Chưa có tài liệu nào' }}
          columns={[
            { title: 'Tên tệp', render: (_: unknown, a) => <FileLink compact url={`${API_URL}/projects/${id}/attachments/${a.id}`} fileName={a.fileName} contentType={a.contentType} /> },
            { title: 'Cỡ', align: 'right', render: (_: unknown, a) => fileSizeText(a.sizeBytes) },
            { title: 'Tải lên lúc', render: (_: unknown, a) => dateTimeText(a.createdAt) },
          ]}
        />
      </Space>
    </Card>
  );
}

// ---- Cuộc họp của đề án

function MeetingsCard({ detail, people, myPersonId, canReadAll }: { detail: ProjectDetail; people: Option[]; myPersonId: string | null; canReadAll: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const id = detail.project.id;
  const { data, error, loading } = useRemote<MeetingRow[]>(`/meetings?projectId=${id}&scope=${canReadAll ? 'all' : 'mine'}`);

  return (
    <Card
      size="small"
      title={`Cuộc họp của đề án${data ? ` (${data.length})` : ''}`}
      extra={
        myPersonId && (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Tạo lịch họp
          </Button>
        )
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Table<MeetingRow>
        rowKey={(r) => r.meeting.id}
        size="small"
        loading={loading}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: 'max-content' }}
        dataSource={data ?? []}
        locale={{ emptyText: 'Chưa có cuộc họp nào của đề án này' }}
        columns={[
          { title: 'Giờ', render: (_: unknown, r) => <span style={{ whiteSpace: 'nowrap' }}>{meetingRangeText(r.meeting.startAt, r.meeting.endAt)}</span> },
          { title: 'Tiêu đề', render: (_: unknown, r) => <Link href={`/meetings/${r.meeting.id}`}>{r.meeting.title}</Link> },
          { title: 'Chủ trì', dataIndex: 'organizerName' },
          { title: 'Trạng thái', render: (_: unknown, r) => <Tag color={MEETING_STATUS_COLORS[r.meeting.status]}>{MEETING_STATUS_LABELS[r.meeting.status]}</Tag> },
        ]}
      />
      {creating && myPersonId && <MeetingFormModal people={people} myPersonId={myPersonId} defaultProjectId={id} onClose={() => setCreating(false)} onSaved={(m) => router.push(`/meetings/${m.id}`)} />}
    </Card>
  );
}

/** Thành viên, mốc tiến độ, việc được giao và tài liệu của một đề án, dự án. */
export default function ProjectSections({ detail, people, myPersonId, canReadAllMeetings = false }: Props) {
  // Không đọc được sơ đồ tổ chức thì chỉ chọn người phụ trách trong số thành viên.
  const options = people.length > 0 ? people : detail.members.map((m) => ({ value: m.personId, label: m.fullName }));
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <MembersCard detail={detail} people={people} />
      <MilestonesCard detail={detail} options={options} myPersonId={myPersonId} />
      <WorkCard detail={detail} />
      <MeetingsCard detail={detail} people={people} myPersonId={myPersonId} canReadAll={canReadAllMeetings} />
      <AttachmentsCard detail={detail} />
    </Space>
  );
}
