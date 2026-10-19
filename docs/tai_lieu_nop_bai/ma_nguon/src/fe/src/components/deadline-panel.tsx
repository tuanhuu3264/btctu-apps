'use client';

import { BellOutlined, CalendarOutlined } from '@ant-design/icons';
import { Alert, Button, DatePicker, Form, Input, Modal, Space } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { Period } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { useAction } from '@/lib/use-action';

const dmy = (iso: string) => iso.split('-').reverse().join('/');

/**
 * Hạn hoàn thành đánh giá, xếp loại của kỳ năm: 15/12, trường hợp đặc biệt 15/01 năm sau (Nghị định 335 Điều 9.1, 15.2).
 * Chỉ nhắc và cảnh báo, không khóa thao tác (ADR-038). Văn phòng gia hạn và gửi nhắc việc.
 */
export default function DeadlinePanel({ period, canManage, scope }: { period: Period; canManage: boolean; scope: 'cá nhân' | 'tập thể' }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ deadline: dayjs.Dayjs; reason?: string }>();
  const d = period.deadline;
  if (period.type !== 'YEAR' || !d) return null;
  const year = period.year ?? Number(period.label);
  const closed = period.status !== 'OPEN';

  const type = closed ? 'info' : d.overdue ? 'error' : d.reminder ? 'warning' : 'info';
  const text = d.overdue
    ? `Đã quá hạn ${-d.daysLeft} ngày (hạn ${dmy(d.date)}).`
    : d.daysLeft === 0
      ? `Hôm nay là hạn hoàn thành (${dmy(d.date)}).`
      : `Còn ${d.daysLeft} ngày đến hạn ${dmy(d.date)}.`;

  return (
    <>
      <Alert
        type={type}
        showIcon
        icon={<CalendarOutlined />}
        message={`Hạn hoàn thành đánh giá, xếp loại ${scope}: ${text}${d.extended ? ' Đã gia hạn theo trường hợp đặc biệt.' : ''}`}
        description="Theo Nghị định 335/2025/NĐ-CP Điều 9.1 và 15.2: hoàn thành trước ngày 15/12 hằng năm; trường hợp đặc biệt theo quy định của cấp có thẩm quyền thì trước ngày 15/01 năm sau. Hệ thống chỉ nhắc và cảnh báo, vẫn cho xử lý sau hạn."
        action={
          canManage && !closed ? (
            <Space>
              <Button size="small" onClick={() => setOpen(true)}>
                Gia hạn
              </Button>
              <Button
                size="small"
                icon={<BellOutlined />}
                loading={busy}
                onClick={() => run(async () => void (await apiCall('POST', `/evaluation/periods/${period.id}/remind`)), { success: 'Đã gửi nhắc việc cho người đang giữ hồ sơ chưa xong' })}
              >
                Nhắc việc
              </Button>
            </Space>
          ) : undefined
        }
      />
      <Modal
        title="Gia hạn hoặc đặt lại hạn"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        okText="Lưu hạn"
        cancelText="Hủy"
        confirmLoading={busy}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ deadline: dayjs(d.date) }}
          onFinish={(v) =>
            run(
              async () => {
                await apiCall('PUT', `/evaluation/periods/${period.id}/deadline`, { deadline: v.deadline.format('YYYY-MM-DD'), reason: v.reason?.trim() || undefined });
                setOpen(false);
              },
              { success: 'Đã lưu hạn hoàn thành' },
            )
          }
        >
          <Form.Item name="deadline" label="Hạn hoàn thành" rules={[{ required: true, message: 'Chọn ngày' }]} extra={`Từ 15/12/${year} đến 15/01/${year + 1}.`}>
            <DatePicker
              format="DD/MM/YYYY"
              disabledDate={(day) => day.isBefore(dayjs(`${year}-12-15`), 'day') || day.isAfter(dayjs(`${year + 1}-01-15`), 'day')}
              defaultPickerValue={dayjs(`${year}-12-15`)}
            />
          </Form.Item>
          <Form.Item name="reason" label="Căn cứ (bắt buộc khi gia hạn sau 15/12)">
            <Input.TextArea rows={2} maxLength={500} placeholder="Ví dụ: Theo chỉ đạo số … của Ban Thường vụ" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
