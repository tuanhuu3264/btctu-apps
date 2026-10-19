'use client';

import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, DatePicker, Empty, Form, Input, List, Modal, Radio, Select, Space, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { ComplaintKind, UnitComplaint } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

const KIND_LABELS: Record<ComplaintKind, string> = {
  KHIEU_NAI: 'Khiếu nại',
  TO_CAO: 'Tố cáo',
  PHAN_ANH: 'Phản ánh tiêu cực',
  MAT_DOAN_KET: 'Dấu hiệu mất đoàn kết nội bộ',
};
const STATUS: Record<UnitComplaint['status'], { label: string; color: string }> = {
  RECEIVED: { label: 'Mới ghi nhận', color: 'orange' },
  VERIFYING: { label: 'Đang xác minh', color: 'blue' },
  CLOSED: { label: 'Đã kết luận', color: 'green' },
};
const dmy = (iso: string) => iso.split('-').reverse().join('/');

interface Props {
  evaluationId: string;
  /** Danh sách đã lấy ở máy chủ; null khi người xem không có thẩm quyền xem nội dung. */
  items: UnitComplaint[] | null;
  /** Văn phòng: ghi nhận (complaint:manage). */
  canRecord: boolean;
  /** Có thể là người công nhận: chỉ đạo xác minh và kết luận (máy chủ kiểm tra lại). */
  canDecide: boolean;
}

/**
 * Khiếu nại, phản ánh về tập thể (ADR-038, Nghị định 335 Điều 9.2.a). Còn khiếu nại chưa kết luận thì chưa công nhận
 * được xếp loại. Nội dung nhạy cảm nên chỉ người có thẩm quyền xem.
 */
export default function ComplaintsPanel({ evaluationId, items, canRecord, canDecide }: Props) {
  const { run, busy } = useAction();
  const [creating, setCreating] = useState(false);
  const [directing, setDirecting] = useState<UnitComplaint | null>(null);
  const [closing, setClosing] = useState<UnitComplaint | null>(null);
  const [createForm] = Form.useForm<{ kind: ComplaintKind; content: string; source?: string; receivedOn?: dayjs.Dayjs }>();
  const [directForm] = Form.useForm<{ assignee: string; dueDate?: dayjs.Dayjs }>();
  const [closeForm] = Form.useForm<{ outcome: 'SUBSTANTIATED' | 'UNFOUNDED'; conclusion: string }>();

  if (items === null) return null;

  const act = (fn: () => Promise<unknown>, success: string, done: () => void) =>
    run(
      async () => {
        await fn();
        done();
      },
      { success },
    );

  return (
    <Card
      size="small"
      title="Khiếu nại, phản ánh về đơn vị"
      style={{ marginTop: 16 }}
      extra={
        canRecord && (
          <Button icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Ghi nhận
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">
        Có đơn thư khiếu nại, tố cáo, phản ánh tiêu cực hoặc dấu hiệu mất đoàn kết nội bộ thì người có thẩm quyền công nhận phải chỉ đạo kiểm tra, xác minh trước khi quyết định xếp loại (Nghị định 335 Điều 9.2.a). Kết luận “đúng” không tự hạ xếp loại; người công nhận quyết định và nêu lý do.
      </Typography.Paragraph>
      {items.length === 0 && <Empty description="Chưa có khiếu nại, phản ánh nào" />}
      <List
        dataSource={items}
        renderItem={(c) => (
          <List.Item
            actions={[
              canDecide && c.status === 'RECEIVED' && (
                <Button key="d" size="small" type="primary" onClick={() => setDirecting(c)}>
                  Chỉ đạo xác minh
                </Button>
              ),
              canDecide && c.status === 'VERIFYING' && (
                <Button key="c" size="small" type="primary" onClick={() => setClosing(c)}>
                  Kết luận
                </Button>
              ),
            ].filter(Boolean)}
          >
            <List.Item.Meta
              title={
                <Space wrap>
                  <Tag>{KIND_LABELS[c.kind]}</Tag>
                  <Tag color={STATUS[c.status].color}>{STATUS[c.status].label}</Tag>
                  <span>Nhận ngày {dmy(c.receivedOn)}</span>
                  {c.source && <span>· {c.source}</span>}
                </Space>
              }
              description={
                <>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
                  {c.assignee && (
                    <div>
                      Giao xác minh: {c.assignee}
                      {c.verifyDue ? ` (hạn ${dmy(c.verifyDue)})` : ''}
                    </div>
                  )}
                  {c.conclusion && (
                    <div>
                      <b>Kết luận ({c.outcome === 'SUBSTANTIATED' ? 'xác minh đúng' : 'xác minh không đúng'}):</b> {c.conclusion}
                    </div>
                  )}
                </>
              }
            />
          </List.Item>
        )}
      />

      <Modal title="Ghi nhận khiếu nại, phản ánh" open={creating} onCancel={() => setCreating(false)} onOk={() => createForm.submit()} okText="Ghi nhận" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ kind: 'PHAN_ANH' }}
          onFinish={(v) =>
            act(
              () => apiCall('POST', `/unit-complaint/evaluation/${evaluationId}`, { kind: v.kind, content: v.content.trim(), source: v.source?.trim() || undefined, receivedOn: v.receivedOn?.format('YYYY-MM-DD') }),
              'Đã ghi nhận',
              () => {
                setCreating(false);
                createForm.resetFields();
              },
            )
          }
        >
          <Form.Item name="kind" label="Loại" rules={[{ required: true }]}>
            <Select options={(Object.keys(KIND_LABELS) as ComplaintKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))} />
          </Form.Item>
          <Form.Item name="content" label="Nội dung" rules={[{ required: true, min: 10, message: 'Nêu nội dung (ít nhất 10 ký tự)' }]}>
            <Input.TextArea rows={4} maxLength={4000} />
          </Form.Item>
          <Form.Item name="source" label="Nguồn (đơn thư, đường dây, cơ quan chuyển đến)">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="receivedOn" label="Ngày nhận (mặc định hôm nay)">
            <DatePicker format="DD/MM/YYYY" disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Chỉ đạo kiểm tra, xác minh" open={directing !== null} onCancel={() => setDirecting(null)} onOk={() => directForm.submit()} okText="Chỉ đạo" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form
          form={directForm}
          layout="vertical"
          onFinish={(v) =>
            act(
              () => apiCall('POST', `/unit-complaint/${directing!.id}/verify`, { assignee: v.assignee.trim(), dueDate: v.dueDate?.format('YYYY-MM-DD') }),
              'Đã chỉ đạo xác minh',
              () => setDirecting(null),
            )
          }
        >
          <Form.Item name="assignee" label="Người hoặc bộ phận được giao" rules={[{ required: true, min: 3, message: 'Nêu người hoặc bộ phận' }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="dueDate" label="Hạn xác minh">
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="Kết luận xác minh" open={closing !== null} onCancel={() => setClosing(null)} onOk={() => closeForm.submit()} okText="Kết luận" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form
          form={closeForm}
          layout="vertical"
          onFinish={(v) => act(() => apiCall('POST', `/unit-complaint/${closing!.id}/close`, { outcome: v.outcome, conclusion: v.conclusion.trim() }), 'Đã kết luận', () => setClosing(null))}
        >
          <Form.Item name="outcome" label="Kết quả xác minh" rules={[{ required: true, message: 'Chọn kết quả' }]}>
            <Radio.Group>
              <Radio value="UNFOUNDED">Không đúng</Radio>
              <Radio value="SUBSTANTIATED">Đúng</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="conclusion" label="Nội dung kết luận" rules={[{ required: true, min: 10, message: 'Nêu kết luận (ít nhất 10 ký tự)' }]}>
            <Input.TextArea rows={4} maxLength={4000} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
