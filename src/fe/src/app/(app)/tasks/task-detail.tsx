'use client';

import { EditOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { App, Alert, Button, Checkbox, Descriptions, Drawer, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tabs, Tag, Typography, Upload } from 'antd';
import type { UploadFile } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AssignmentView, Conversation, OrgUnit, WorkAttachment, WorkComment, WorkProgress } from '@/lib/api';
import FileLink from '@/components/file-link';
import { API_URL, apiCall, apiGet, apiUpload } from '@/lib/client';
import { dateText, dateTimeText, fileSizeText, PROGRESS_LABELS, REPORT_KIND_LABELS, STATE_COLORS, STATE_LABELS } from '@/lib/labels';
import { holderLabel, holdersOf, superiorsOf } from '@/lib/org';

const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TEXT = 4000;

interface Props {
  view: AssignmentView;
  tree: OrgUnit[];
  names: Record<string, string>;
  myPersonId: string | null;
  /** Người giao (cấp trên trực tiếp của người nhận): sửa được nội dung, người duyệt, người tham vấn. */
  canEdit: boolean;
  onClose: () => void;
  /** Báo cho danh sách tải lại sau khi việc đổi. */
  onChanged: () => void;
}

const downloadUrl = (assignmentId: string, file: WorkAttachment) => `${API_URL}/tasking/assignments/${assignmentId}/attachments/${file.id}`;

/** Hộp thoại sửa nội dung, người duyệt (cc) và người tham vấn. Chỉ được dựng khi đang mở. */
function ParticipantsModal({ view, tree, onClose, onSaved }: { view: AssignmentView; tree: OrgUnit[]; onClose: () => void; onSaved: (v: AssignmentView) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ note?: string; approverPersonId?: string; consultantPersonIds?: string[] }>();
  const [busy, setBusy] = useState(false);
  const assignee = view.assignment.assigneePersonId;
  const superiors = useMemo(() => superiorsOf(tree, assignee), [tree, assignee]);
  const everyone = useMemo(() => holdersOf(tree).filter((h) => h.personId !== assignee), [tree, assignee]);

  async function submit(v: { note?: string; approverPersonId?: string; consultantPersonIds?: string[] }) {
    setBusy(true);
    try {
      const updated = await apiCall<AssignmentView>('PATCH', `/tasking/assignments/${view.assignment.id}`, {
        note: v.note?.trim() || null,
        approverPersonId: v.approverPersonId ?? null,
        consultantPersonIds: v.consultantPersonIds ?? [],
      });
      message.success('Đã lưu');
      if (updated) onSaved(updated);
      onClose();
    } catch (e) {
      message.error({ content: e instanceof Error ? e.message : 'Lỗi không xác định', duration: 6 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Sửa nội dung và người tham gia" open onCancel={onClose} onOk={() => form.submit()} okText="Lưu" cancelText="Hủy" confirmLoading={busy} width={640}>
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{ note: view.assignment.note ?? undefined, approverPersonId: view.approverPersonId ?? undefined, consultantPersonIds: view.consultantPersonIds }}
      >
        <Form.Item name="note" label="Nội dung">
          <Input.TextArea rows={5} maxLength={MAX_TEXT} showCount />
        </Form.Item>
        <Form.Item name="approverPersonId" label="Người duyệt (cc)" extra="Người xác nhận hoặc từ chối báo cáo. Để trống: cấp trên trực tiếp.">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Mặc định: cấp trên trực tiếp"
            options={superiors.map((h, i) => ({ value: h.personId, label: `${holderLabel(h)}${i === 0 ? ' (cấp trên trực tiếp)' : ''}` }))}
          />
        </Form.Item>
        <Form.Item name="consultantPersonIds" label="Người tham vấn" extra="Tối đa 10 người. Họ xem được việc, trao đổi và góp ý.">
          <Select mode="multiple" allowClear showSearch optionFilterProp="label" maxCount={10} placeholder="Chọn người tham vấn" options={everyone.map((h) => ({ value: h.personId, label: holderLabel(h) }))} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function InfoTab({ view, names, canEdit, onEdit }: { view: AssignmentView; names: Record<string, string>; canEdit: boolean; onEdit: () => void }) {
  const a = view.assignment;
  const nameOf = (id: string | null) => (id ? (names[id] ?? 'Không rõ') : '–');
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {canEdit && a.status === 'OPEN' && (
        <Button icon={<EditOutlined />} onClick={onEdit}>
          Sửa nội dung, người duyệt, người tham vấn
        </Button>
      )}
      <Descriptions
        bordered
        size="small"
        column={1}
        labelStyle={{ width: 170 }}
        items={[
          { key: 'task', label: 'Nhiệm vụ', children: view.task.title || '–' },
          { key: 'item', label: 'Công việc', children: <><strong>{a.catalogItemCode}</strong> {view.itemName}</> },
          { key: 'note', label: 'Nội dung', children: <div style={{ whiteSpace: 'pre-wrap' }}>{a.note ?? '–'}</div> },
          { key: 'assignee', label: 'Cán bộ nhận việc', children: nameOf(a.assigneePersonId) },
          { key: 'created', label: 'Ngày giao', children: dateTimeText(a.createdAt) },
          { key: 'due', label: 'Hạn hoàn thành', children: dateText(a.dueDate) },
          {
            key: 'kinds',
            label: 'Thời gian báo cáo',
            children:
              a.periodMode === 'AUTO' ? (
                <Space size={4} wrap>
                  <Tag color="geekblue">Tự động</Tag>
                  <span style={{ color: '#888' }}>vào báo cáo tháng, quý, năm chứa hạn</span>
                </Space>
              ) : (
                <Space size={4} wrap>
                  {a.reportKinds.map((k) => (
                    <Tag key={k}>{REPORT_KIND_LABELS[k]}</Tag>
                  ))}
                </Space>
              ),
          },
          {
            key: 'qty',
            label: 'Số lượng',
            children: `Giao ${a.plannedQuantity} · đã xác nhận ${view.summary.confirmedQuantity}${view.summary.pendingQuantity > 0 ? ` · chờ xác nhận ${view.summary.pendingQuantity}` : ''}`,
          },
          {
            key: 'state',
            label: 'Trạng thái',
            children: (
              <>
                <Tag color={STATE_COLORS[view.state]}>{STATE_LABELS[view.state]}</Tag>
                {view.summary.lateCount > 0 && <Tag color="orange">chậm {view.summary.lateCount}</Tag>}
                {view.summary.reworkCount > 0 && <Tag color="volcano">chưa đạt {view.summary.reworkCount}</Tag>}
              </>
            ),
          },
          {
            key: 'approver',
            label: 'Người duyệt (cc)',
            children: (
              <>
                {nameOf(view.confirmerPersonId)} <Tag>{view.approverPersonId ? 'chỉ định' : 'cấp trên trực tiếp'}</Tag>
              </>
            ),
          },
          {
            key: 'consultants',
            label: 'Người tham vấn',
            children:
              view.consultantPersonIds.length === 0 ? (
                '–'
              ) : (
                <Space size={4} wrap>
                  {view.consultantPersonIds.map((id) => (
                    <Tag key={id}>{nameOf(id)}</Tag>
                  ))}
                </Space>
              ),
          },
        ]}
      />
      <Typography.Title level={5} style={{ margin: 0 }}>
        Các lần báo cáo
      </Typography.Title>
      <Table<WorkProgress>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={view.progress}
        locale={{ emptyText: 'Chưa có báo cáo nào' }}
        columns={[
          { title: 'Ngày hoàn thành', render: (_: unknown, p) => dateText(p.completedOn) },
          { title: 'Số lượng', dataIndex: 'quantity', align: 'right' },
          { title: 'Minh chứng', dataIndex: 'evidence', render: (e: string | null) => e ?? '–' },
          {
            title: 'Trạng thái',
            render: (_: unknown, p) => (
              <>
                <Tag>{PROGRESS_LABELS[p.status]}</Tag>
                {p.decisionNote && <span style={{ color: '#888' }}>{p.decisionNote}</span>}
              </>
            ),
          },
        ]}
      />
    </Space>
  );
}

function FileLinks({ assignmentId, files }: { assignmentId: string; files: WorkAttachment[] }) {
  if (files.length === 0) return null;
  return (
    <Space size={[8, 4]} wrap style={{ marginTop: 6 }}>
      {files.map((f) => (
        <FileLink key={f.id} url={downloadUrl(assignmentId, f)} fileName={f.fileName} contentType={f.contentType} sizeBytes={f.sizeBytes} />
      ))}
    </Space>
  );
}

/** Chọn tệp: kiểm tra định dạng và cỡ ngay ở trình duyệt (máy chủ kiểm tra lại). */
function useFilePicker() {
  const { message } = App.useApp();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const props = {
    accept: ACCEPT,
    multiple: true,
    fileList: files,
    beforeUpload: (file: UploadFile & File) => {
      if (file.size > MAX_FILE_BYTES) {
        message.error(`${file.name}: tệp tối đa 20 MB`);
        return Upload.LIST_IGNORE;
      }
      setFiles((prev) => [...prev, file]);
      return false;
    },
    onRemove: (file: UploadFile) => setFiles((prev) => prev.filter((f) => f.uid !== file.uid)),
  };
  return { files, props, reset: () => setFiles([]) };
}

function ChatTab({ view, names, isConsultant, conv, onReload }: { view: AssignmentView; names: Record<string, string>; isConsultant: boolean; conv: Conversation; onReload: () => void }) {
  const { message } = App.useApp();
  const [text, setText] = useState('');
  const [asOpinion, setAsOpinion] = useState(false);
  const [sending, setSending] = useState(false);
  const picker = useFilePicker();
  const id = view.assignment.id;

  async function send() {
    const body = text.trim();
    if (!body && picker.files.length === 0) return;
    setSending(true);
    try {
      let commentId: string | undefined;
      if (body) commentId = (await apiCall<WorkComment>('POST', `/tasking/assignments/${id}/comments`, { body, kind: asOpinion ? 'OPINION' : 'MESSAGE' }))?.id;
      const failed: string[] = [];
      for (const f of picker.files) {
        try {
          await apiUpload(`/tasking/assignments/${id}/attachments`, f as unknown as File, commentId ? { commentId } : {});
        } catch (e) {
          failed.push(`${f.name}: ${e instanceof Error ? e.message : 'lỗi'}`);
        }
      }
      if (failed.length > 0) message.error({ content: `Không tải được: ${failed.join('; ')}`, duration: 8 });
      setText('');
      setAsOpinion(false);
      picker.reset();
      onReload();
    } catch (e) {
      message.error({ content: e instanceof Error ? e.message : 'Lỗi không xác định', duration: 6 });
    } finally {
      setSending(false);
    }
  }

  const nameOf = (c: WorkComment) => (c.authorPersonId ? (names[c.authorPersonId] ?? 'Không rõ') : 'Không rõ');
  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {conv.comments.length === 0 ? (
        <Empty description="Chưa có trao đổi nào" />
      ) : (
        conv.comments.map((c) => (
          <div
            key={c.id}
            style={{ borderLeft: `3px solid ${c.kind === 'OPINION' ? '#faad14' : '#d9d9d9'}`, padding: '4px 12px', background: c.kind === 'OPINION' ? '#fffbe6' : undefined }}
          >
            <div style={{ color: '#888', fontSize: 12 }}>
              <strong style={{ color: 'inherit' }}>{nameOf(c)}</strong> · {dateTimeText(c.createdAt)} {c.kind === 'OPINION' && <Tag color="gold">Ý kiến tham vấn</Tag>}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
            <FileLinks assignmentId={id} files={conv.attachments.filter((f) => f.commentId === c.id)} />
          </div>
        ))
      )}
      <div>
        <Input.TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX_TEXT} placeholder="Nhập nội dung trao đổi" />
        <Space style={{ marginTop: 8 }} wrap>
          <Upload {...picker.props}>
            <Button icon={<PaperClipOutlined />}>Đính kèm tệp</Button>
          </Upload>
          {isConsultant && (
            <Checkbox checked={asOpinion} onChange={(e) => setAsOpinion(e.target.checked)}>
              Gửi dưới dạng ý kiến tham vấn
            </Checkbox>
          )}
          <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={send} disabled={!text.trim() && picker.files.length === 0}>
            Gửi
          </Button>
        </Space>
      </div>
    </Space>
  );
}

function FilesTab({ view, conv, names, onReload }: { view: AssignmentView; conv: Conversation; names: Record<string, string>; onReload: () => void }) {
  const { message } = App.useApp();
  const [uploading, setUploading] = useState(false);
  const picker = useFilePicker();
  const id = view.assignment.id;
  const authorOf = (f: WorkAttachment) => {
    const personId = conv.comments.find((c) => c.authorAccountId === f.uploadedByAccountId)?.authorPersonId;
    return personId ? (names[personId] ?? '–') : '–';
  };

  async function upload() {
    setUploading(true);
    const failed: string[] = [];
    for (const f of picker.files) {
      try {
        await apiUpload(`/tasking/assignments/${id}/attachments`, f as unknown as File);
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : 'lỗi'}`);
      }
    }
    if (failed.length > 0) message.error({ content: `Không tải được: ${failed.join('; ')}`, duration: 8 });
    else message.success('Đã tải lên');
    picker.reset();
    setUploading(false);
    onReload();
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Upload {...picker.props}>
          <Button icon={<PaperClipOutlined />}>Chọn tệp</Button>
        </Upload>
        <Button type="primary" loading={uploading} disabled={picker.files.length === 0} onClick={upload}>
          Tải lên
        </Button>
      </Space>
      <Typography.Text type="secondary">Tối đa 20 MB mỗi tệp, 30 tệp mỗi việc. Nhận pdf, Word, Excel, PowerPoint, txt, csv, png, jpg. Tệp không sửa, không xóa được.</Typography.Text>
      <Table<WorkAttachment>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={conv.attachments}
        locale={{ emptyText: 'Chưa có tệp nào' }}
        columns={[
          {
            title: 'Tên tệp',
            render: (_: unknown, f) => <FileLink compact url={downloadUrl(id, f)} fileName={f.fileName} contentType={f.contentType} />,
          },
          { title: 'Cỡ', align: 'right', render: (_: unknown, f) => fileSizeText(f.sizeBytes) },
          { title: 'Người tải', render: (_: unknown, f) => authorOf(f) },
          { title: 'Thời gian', render: (_: unknown, f) => dateTimeText(f.uploadedAt) },
          { title: 'Trong', render: (_: unknown, f) => (f.commentId ? <Tag>tin nhắn</Tag> : '–') },
        ]}
      />
    </Space>
  );
}

/** Chi tiết một việc: thông tin, trao đổi, tệp đính kèm (ADR-024). */
export default function TaskDetail({ view: initial, tree, names, myPersonId, canEdit, onClose, onChanged }: Props) {
  const [view, setView] = useState(initial);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [convError, setConvError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const id = initial.assignment.id;

  const load = useCallback(() => {
    apiGet<Conversation>(`/tasking/assignments/${id}/conversation`)
      .then((c) => {
        setConv(c);
        setConvError(null);
      })
      .catch((e: Error) => setConvError(e.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isConsultant = myPersonId !== null && view.consultantPersonIds.includes(myPersonId);
  const conversationNode = convError ? (
    <Alert type="info" showIcon message={convError} />
  ) : conv === null ? (
    <Spin />
  ) : (
    <ChatTab view={view} names={names} isConsultant={isConsultant} conv={conv} onReload={load} />
  );

  return (
    <Drawer title={`${view.assignment.catalogItemCode} ${view.itemName}`} open onClose={onClose} size={760} destroyOnHidden>
      <Tabs
        items={[
          { key: 'info', label: 'Thông tin', children: <InfoTab view={view} names={names} canEdit={canEdit} onEdit={() => setEditing(true)} /> },
          { key: 'chat', label: `Trao đổi${conv ? ` (${conv.comments.length})` : ''}`, children: conversationNode },
          {
            key: 'files',
            label: `Tệp đính kèm${conv ? ` (${conv.attachments.length})` : ''}`,
            children: convError ? <Alert type="info" showIcon message={convError} /> : conv === null ? <Spin /> : <FilesTab view={view} conv={conv} names={names} onReload={load} />,
          },
        ]}
      />
      {editing && (
        <ParticipantsModal
          view={view}
          tree={tree}
          onClose={() => setEditing(false)}
          onSaved={(v) => {
            setView(v);
            onChanged();
          }}
        />
      )}
    </Drawer>
  );
}
