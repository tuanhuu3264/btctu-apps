'use client';

import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Radio, Space, Table, Tag } from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useState } from 'react';
import type { AssignmentView, ProgressStatus, SearchScope, WorkProgress } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { dateText, PROGRESS_LABELS, REPORT_KIND_LABELS, STATE_COLORS, STATE_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

type Mode = SearchScope;

interface Props {
  rows: AssignmentView[];
  mode: Mode;
  myPersonId: string | null;
  names: Record<string, string>;
  canReport: boolean;
  canConfirm: boolean;
  canAssign: boolean;
  /** Ẩn cột cán bộ khi bảng nằm trong một nhiệm vụ (nhiệm vụ đã thuộc về một cán bộ). */
  hideAssignee?: boolean;
  /** Cán bộ cấp dưới trực tiếp: chỉ cấp trên trực tiếp mới hủy được việc. Không nêu thì dựa vào người xác nhận. */
  directReportIds?: Set<string>;
  /** Hiện tên nhiệm vụ trên từng dòng (danh sách phẳng, không nhóm theo nhiệm vụ). */
  showTask?: boolean;
  loading?: boolean;
  emptyText?: string;
  /** Mở chi tiết việc (trao đổi, tệp, người tham gia). */
  onOpen?: (view: AssignmentView) => void;
  /** Phân trang do nơi gọi điều khiển (máy chủ). Không nêu thì tự phân trang khi quá 20 dòng. */
  pagination?: TablePaginationConfig | false;
}

const PROGRESS_COLORS: Record<ProgressStatus, string> = { REPORTED: 'processing', CONFIRMED: 'success', REJECTED: 'error' };

function ReportModal({ view, onClose }: { view: AssignmentView; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ quantity: number; completedOn: { format: (p: string) => string }; evidence?: string }>();
  const a = view.assignment;
  const remaining = Math.max(a.plannedQuantity - view.summary.confirmedQuantity - view.summary.pendingQuantity, 0);

  async function submit(v: { quantity: number; completedOn: { format: (p: string) => string }; evidence?: string }) {
    const ok = await run(
      async () =>
        void (await apiCall('POST', `/tasking/assignments/${a.id}/progress`, {
          quantity: v.quantity,
          completedOn: v.completedOn.format('YYYY-MM-DD'),
          ...(v.evidence?.trim() ? { evidence: v.evidence.trim() } : {}),
        })),
      { success: 'Đã gửi báo cáo, chờ cấp trên xác nhận' },
    );
    if (ok) onClose();
  }

  return (
    <Modal title={`Báo cáo hoàn thành: ${a.catalogItemCode}`} open onCancel={onClose} onOk={() => form.submit()} okText="Gửi báo cáo" cancelText="Hủy" confirmLoading={busy}>
      <p>
        {view.itemName}. Giao {a.plannedQuantity}, đã xác nhận {view.summary.confirmedQuantity}, đang chờ xác nhận {view.summary.pendingQuantity}. Hạn {dateText(a.dueDate)}.
      </p>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ quantity: remaining || undefined }}>
        <Form.Item name="quantity" label="Số lượng đã hoàn thành lần này" rules={[{ required: true, message: 'Nhập số lượng' }]}>
          <InputNumber min={1} max={100000} precision={0} />
        </Form.Item>
        <Form.Item name="completedOn" label="Ngày hoàn thành" rules={[{ required: true, message: 'Chọn ngày' }]} extra="Sau hạn sẽ được tính là một lần chậm khi cấp trên xác nhận.">
          <DatePicker format="DD/MM/YYYY" disabledDate={(d) => d.valueOf() > Date.now()} />
        </Form.Item>
        <Form.Item name="evidence" label="Minh chứng">
          <Input.TextArea rows={2} maxLength={2000} placeholder="Số hiệu văn bản, đường dẫn, mô tả sản phẩm..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function RejectModal({ progress, onClose }: { progress: WorkProgress; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ note: string; majorError: boolean }>();

  async function submit(v: { note: string; majorError: boolean }) {
    const ok = await run(async () => void (await apiCall('POST', `/tasking/progress/${progress.id}/decision`, { decision: 'REJECT', note: v.note.trim(), majorError: v.majorError })), {
      success: 'Đã từ chối báo cáo',
    });
    if (ok) onClose();
  }

  return (
    <Modal title="Từ chối báo cáo" open onCancel={onClose} onOk={() => form.submit()} okText="Từ chối" okButtonProps={{ danger: true }} cancelText="Hủy" confirmLoading={busy}>
      <p>Báo cáo {progress.quantity} sản phẩm ngày {dateText(progress.completedOn)}. Cán bộ phải báo cáo lại; chỉ sai sót lớn mới bị trừ điểm.</p>
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item
          name="majorError"
          label="Mức độ"
          rules={[{ required: true, message: 'Chọn mức độ' }]}
          extra="Nghị định 335/2025/NĐ-CP Điều 14.2.b: sai sót lớn về nội dung ảnh hưởng đến chất lượng thì mỗi lần chưa đạt bị trừ 25% điểm chất lượng của công việc đó."
        >
          <Radio.Group>
            <Radio value={true}>Sai sót lớn về nội dung (bị trừ 25%)</Radio>
            <Radio value={false}>Lý do khác, chỉ yêu cầu làm lại (không trừ)</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="note" label="Lý do" rules={[{ required: true, whitespace: true, min: 3, message: 'Nhập lý do (ít nhất 3 ký tự)' }]}>
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function AssignmentTable({ rows, mode, myPersonId, names, canReport, canConfirm, canAssign, hideAssignee = false, directReportIds, showTask = false, loading = false, emptyText, onOpen, pagination }: Props) {
  const { run, busy } = useAction();
  const [reporting, setReporting] = useState<AssignmentView | null>(null);
  const [rejecting, setRejecting] = useState<WorkProgress | null>(null);

  const statusTag = (v: AssignmentView) => <Tag color={STATE_COLORS[v.state]}>{STATE_LABELS[v.state]}</Tag>;
  // Hủy việc là quyền của cấp trên trực tiếp (người giao), khác người duyệt (cc) có thể là cấp trên xa hơn.
  const iAssign = (v: AssignmentView) => (directReportIds ? directReportIds.has(v.assignment.assigneePersonId) : iConfirm(v));

  const isMine = (v: AssignmentView) => myPersonId !== null && v.assignment.assigneePersonId === myPersonId;
  const iConfirm = (v: AssignmentView) => myPersonId !== null && v.confirmerPersonId === myPersonId;

  return (
    <>
      <Table<AssignmentView>
        rowKey={(v) => v.assignment.id}
        size="middle"
        dataSource={rows}
        loading={loading}
        pagination={pagination ?? (rows.length > 20 ? { pageSize: 20 } : false)}
        locale={{ emptyText: emptyText ?? (mode === 'mine' ? 'Bạn chưa được giao việc nào.' : 'Chưa có việc nào.') }}
        scroll={{ x: 1100 }}
        columns={[
          ...(mode !== 'mine' && !hideAssignee ? [{ title: 'Cán bộ', render: (_: unknown, v: AssignmentView) => names[v.assignment.assigneePersonId] ?? v.assignment.assigneePersonId }] : []),
          {
            title: showTask ? 'Việc' : 'Nhiệm vụ',
            render: (_: unknown, v: AssignmentView) => (
              <>
                {showTask && v.task.title && <div style={{ color: '#888', fontSize: 12 }}>{v.task.title}</div>}
                <strong>{v.assignment.catalogItemCode}</strong> {v.itemName}
                {v.assignment.note && (
                  <div style={{ color: '#888', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.assignment.note}>
                    {v.assignment.note}
                  </div>
                )}
                {(v.approverPersonId || v.consultantPersonIds.length > 0) && (
                  <Space size={4} style={{ marginTop: 2 }}>
                    {v.approverPersonId && <Tag color="purple">cc: {names[v.approverPersonId] ?? '–'}</Tag>}
                    {v.consultantPersonIds.length > 0 && <Tag color="cyan">tham vấn {v.consultantPersonIds.length}</Tag>}
                  </Space>
                )}
              </>
            ),
          },
          { title: 'Giao', align: 'right', render: (_: unknown, v: AssignmentView) => v.assignment.plannedQuantity },
          {
            title: 'Đã xác nhận',
            align: 'right',
            render: (_: unknown, v: AssignmentView) => (
              <>
                {v.summary.confirmedQuantity}
                {v.summary.pendingQuantity > 0 && <div style={{ color: '#1677ff' }}>+{v.summary.pendingQuantity} chờ</div>}
              </>
            ),
          },
          { title: 'Ngày giao', render: (_: unknown, v: AssignmentView) => dateText(v.assignment.createdAt) },
          { title: 'Hạn', render: (_: unknown, v: AssignmentView) => dateText(v.assignment.dueDate) },
          {
            title: 'Tính vào',
            render: (_: unknown, v: AssignmentView) =>
              v.assignment.periodMode === 'AUTO' ? (
                <Tag color="geekblue">Tự động</Tag>
              ) : (
                <Space size={2} wrap>
                  {v.assignment.reportKinds.map((k) => (
                    <Tag key={k}>{REPORT_KIND_LABELS[k]}</Tag>
                  ))}
                </Space>
              ),
          },
          {
            title: 'Trạng thái',
            render: (_: unknown, v: AssignmentView) => (
              <>
                {statusTag(v)}
                {v.summary.lateCount > 0 && <Tag color="orange">chậm {v.summary.lateCount}</Tag>}
                {v.summary.reworkCount > 0 && <Tag color="volcano">chưa đạt {v.summary.reworkCount}</Tag>}
              </>
            ),
          },
          {
            title: '',
            width: 250,
            render: (_: unknown, v: AssignmentView) => (
              <Space>
                {onOpen && (
                  <Button size="small" onClick={() => onOpen(v)}>
                    Chi tiết
                  </Button>
                )}
                {canReport && isMine(v) && v.assignment.status === 'OPEN' && (
                  <Button size="small" type="primary" onClick={() => setReporting(v)}>
                    Báo cáo
                  </Button>
                )}
                {canAssign && iAssign(v) && v.assignment.status === 'OPEN' && v.summary.confirmedQuantity === 0 && (
                  <Popconfirm
                    title="Hủy việc này?"
                    description="Dùng khi giao nhầm. Việc đã có kết quả được xác nhận thì không hủy được."
                    okText="Hủy việc"
                    okButtonProps={{ danger: true }}
                    cancelText="Không"
                    onConfirm={() => run(async () => void (await apiCall('POST', `/tasking/assignments/${v.assignment.id}/cancel`)), { success: 'Đã hủy việc' })}
                  >
                    <Button size="small" danger loading={busy}>
                      Hủy
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
        expandable={{
          rowExpandable: (v) => v.progress.length > 0,
          defaultExpandedRowKeys: mode === 'team' ? rows.filter((v) => v.progress.some((p) => p.status === 'REPORTED')).map((v) => v.assignment.id) : [],
          expandedRowRender: (v) => (
            <Table<WorkProgress>
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={v.progress}
              columns={[
                { title: 'Ngày hoàn thành', render: (_: unknown, p: WorkProgress) => dateText(p.completedOn) },
                { title: 'Số lượng', dataIndex: 'quantity', align: 'right' },
                { title: 'Minh chứng', dataIndex: 'evidence', render: (e: string | null) => e ?? '–' },
                {
                  title: 'Trạng thái',
                  render: (_: unknown, p: WorkProgress) => (
                    <>
                      <Tag color={PROGRESS_COLORS[p.status]}>{PROGRESS_LABELS[p.status]}</Tag>
                      {p.status === 'CONFIRMED' && p.completedOn > v.assignment.dueDate && <Tag color="orange">chậm</Tag>}
                      {p.decisionNote && <span style={{ color: '#888' }}>{p.decisionNote}</span>}
                    </>
                  ),
                },
                {
                  title: '',
                  width: 200,
                  render: (_: unknown, p: WorkProgress) =>
                    canConfirm && iConfirm(v) && p.status === 'REPORTED' && v.assignment.status === 'OPEN' ? (
                      <Space>
                        <Button
                          size="small"
                          type="primary"
                          icon={<CheckOutlined />}
                          loading={busy}
                          onClick={() => run(async () => void (await apiCall('POST', `/tasking/progress/${p.id}/decision`, { decision: 'CONFIRM' })), { success: 'Đã xác nhận' })}
                        >
                          Xác nhận
                        </Button>
                        <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejecting(p)}>
                          Từ chối
                        </Button>
                      </Space>
                    ) : null,
                },
              ]}
            />
          ),
        }}
      />
      {reporting && <ReportModal view={reporting} onClose={() => setReporting(null)} />}
      {rejecting && <RejectModal progress={rejecting} onClose={() => setRejecting(null)} />}
    </>
  );
}
