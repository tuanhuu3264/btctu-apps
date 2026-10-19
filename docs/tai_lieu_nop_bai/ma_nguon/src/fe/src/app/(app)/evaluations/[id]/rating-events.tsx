'use client';

import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Modal, Popconfirm, Select, Table, Typography } from 'antd';
import { useState } from 'react';
import type { RatingEvent, RatingEventKind } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

export const EVENT_KINDS: Record<RatingEventKind, string> = {
  KY_LUAT: 'Kỷ luật (từ khiển trách trở lên)',
  SUY_THOAI: 'Kết luận có biểu hiện suy thoái',
  TIN_NHIEM_THAP: 'Trên 50% phiếu tín nhiệm thấp',
  THAM_NHUNG_PHAM_VI: 'Tham nhũng, tiêu cực trong phạm vi quản lý trực tiếp',
};
const FORMS: Record<string, string> = {
  KHIEN_TRACH: 'Khiển trách',
  CANH_CAO: 'Cảnh cáo',
  HA_BAC_LUONG: 'Hạ bậc lương',
  GIANG_CHUC: 'Giáng chức',
  CACH_CHUC: 'Cách chức',
  BUOC_THOI_VIEC: 'Buộc thôi việc',
  KHAI_TRU: 'Khai trừ',
};
const SYSTEMS = { DANG: 'Kỷ luật đảng', HANH_CHINH: 'Kỷ luật hành chính' };
const REASONS = { CONG_VU: 'Vi phạm liên quan đến chức trách, công vụ', SUY_THOAI: 'Do suy thoái', KHAC: 'Lý do khác' };
const options = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
const dmy = (d: string) => d.split('-').reverse().join('/');

interface Values {
  kind: RatingEventKind;
  effectiveDate: string;
  decisionNo: string;
  form?: string;
  system?: string;
  reason?: string;
  note?: string;
}

/**
 * Kỷ luật, kết luận, kết quả lấy phiếu ảnh hưởng xếp loại của cán bộ trong năm (ADR-055). Văn phòng ghi nhận; kỳ có sự kiện thì
 * các mục tiêu chí chung liên quan phải Không đảm bảo, năm có sự kiện thì xét xếp loại "Không hoàn thành nhiệm vụ".
 */
export default function RatingEvents({ personId, year, events, canEdit }: { personId: string; year: number; events: RatingEvent[]; canEdit: boolean }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Values>();
  const kind = Form.useWatch('kind', form);

  if (!canEdit && events.length === 0) return null;
  return (
    <Card
      size="small"
      title={`Kỷ luật, kết luận ảnh hưởng xếp loại năm ${year}`}
      style={{ marginTop: 16 }}
      extra={
        canEdit && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            Ghi nhận
          </Button>
        )
      }
    >
      <Typography.Paragraph type="secondary">
        Thông tin nhạy cảm: chỉ cán bộ, cấp trên và người có quyền xem toàn bộ thấy. Kỳ có sự kiện thì các mục tiêu chí chung liên quan phải chấm Không đảm bảo; năm có kỷ luật do vi phạm công vụ, suy thoái (hoặc với lãnh đạo: tín nhiệm thấp, tham nhũng trong phạm vi) thì xếp &quot;Không hoàn thành nhiệm vụ&quot; trừ ngoại lệ (39-QĐ/TU Điều 11 mục 4).
      </Typography.Paragraph>
      <Table<RatingEvent>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={events}
        locale={{ emptyText: 'Chưa ghi nhận' }}
        scroll={{ x: true }}
        columns={[
          { title: 'Hiệu lực', dataIndex: 'effectiveDate', width: 100, render: dmy },
          { title: 'Loại', dataIndex: 'kind', render: (k: RatingEventKind) => EVENT_KINDS[k] },
          { title: 'Văn bản', dataIndex: 'decisionNo' },
          {
            title: 'Chi tiết',
            render: (_: unknown, e) => [e.form && FORMS[e.form], e.system && SYSTEMS[e.system], e.reason && REASONS[e.reason], e.note].filter(Boolean).join('; ') || '–',
          },
          ...(canEdit
            ? [
                {
                  width: 50,
                  render: (_: unknown, e: RatingEvent) => (
                    <Popconfirm
                      title="Xóa bản ghi nhập nhầm?"
                      description="Hồ sơ đã chốt giữ nguyên kết quả đã tính."
                      okText="Xóa"
                      okButtonProps={{ danger: true }}
                      cancelText="Hủy"
                      onConfirm={() => run(async () => void (await apiCall('DELETE', `/evaluation/rating-events/${e.id}`)), { success: 'Đã xóa' })}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label="Xóa" />
                    </Popconfirm>
                  ),
                },
              ]
            : []),
        ]}
      />
      <Modal title="Ghi nhận kỷ luật, kết luận" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Ghi nhận" cancelText="Hủy" confirmLoading={busy} destroyOnHidden>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ kind: 'KY_LUAT', system: 'DANG', reason: 'CONG_VU', form: 'KHIEN_TRACH' }}
          onFinish={async (v) => {
            const discipline = v.kind === 'KY_LUAT';
            const ok = await run(
              async () =>
                void (await apiCall('POST', `/evaluation/persons/${personId}/rating-events`, {
                  kind: v.kind,
                  effectiveDate: v.effectiveDate,
                  decisionNo: v.decisionNo.trim(),
                  ...(discipline ? { form: v.form, system: v.system, reason: v.reason } : {}),
                  note: v.note?.trim() || undefined,
                })),
              { success: 'Đã ghi nhận' },
            );
            if (ok) {
              setOpen(false);
              form.resetFields();
            }
          }}
        >
          <Form.Item name="kind" label="Loại" rules={[{ required: true }]}>
            <Select options={options(EVENT_KINDS)} />
          </Form.Item>
          <Form.Item name="effectiveDate" label="Ngày có hiệu lực" rules={[{ required: true, message: 'Chọn ngày' }]}>
            <Input type="date" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="decisionNo" label="Số, ký hiệu quyết định hoặc văn bản kết luận" rules={[{ required: true, whitespace: true, message: 'Nhập số văn bản' }]}>
            <Input maxLength={100} />
          </Form.Item>
          {kind === 'KY_LUAT' && (
            <>
              <Form.Item name="form" label="Hình thức" rules={[{ required: true }]}>
                <Select options={options(FORMS)} />
              </Form.Item>
              <Form.Item name="system" label="Hệ thống kỷ luật" rules={[{ required: true }]}>
                <Select options={options(SYSTEMS)} />
              </Form.Item>
              <Form.Item name="reason" label="Loại vi phạm" extra="Chỉ vi phạm công vụ hoặc do suy thoái là điều kiện xếp loại Không hoàn thành nhiệm vụ (Nghị định 335 Điều 11.3)." rules={[{ required: true }]}>
                <Select options={options(REASONS)} />
              </Form.Item>
            </>
          )}
          <Form.Item name="note" label="Ghi chú">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
