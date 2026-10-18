'use client';

import { RollbackOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Modal, Select, Table, Typography } from 'antd';
import { useState } from 'react';
import type { EvaluationRevocation, RevocationReasonCode } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { dateTimeText, RATING_LABELS, REVOCATION_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

interface Props {
  evaluationId: string;
  /** Hồ sơ đang ở trạng thái đã phê duyệt và kỳ còn mở: mới hủy được. */
  canRevoke: boolean;
  revocations: EvaluationRevocation[];
}

/**
 * Hủy kết quả đã phê duyệt để xếp loại lại (ADR-059) và lịch sử các lần hủy. Máy chủ chỉ nhận người phê duyệt hồ sơ hoặc cấp trên
 * của người đó; nút chỉ hiện cho người có quyền phê duyệt.
 */
export default function RevocationPanel({ evaluationId, canRevoke, revocations }: Props) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ reasonCode: RevocationReasonCode; note: string }>();

  if (!canRevoke && revocations.length === 0) return null;
  return (
    <>
      {canRevoke && (
        <Card size="small" title="Hủy kết quả để xếp loại lại" style={{ marginTop: 16 }}>
          <Typography.Paragraph>
            Dùng khi phát hiện kết quả đã phê duyệt không bảo đảm điều kiện, tiêu chuẩn của mức xếp loại (tham khảo Quy định 143-QĐ/TU Khánh Hòa, Điều 2.7). Hồ sơ trở về bước giao mục tiêu để cán bộ tự đánh giá lại; kết quả cũ được lưu nguyên trong lịch sử hủy.
          </Typography.Paragraph>
          <Button danger icon={<RollbackOutlined />} onClick={() => setOpen(true)}>
            Hủy kết quả đã phê duyệt
          </Button>
          <Modal
            title="Hủy kết quả đã phê duyệt"
            open={open}
            onCancel={() => setOpen(false)}
            onOk={() => form.submit()}
            okText="Hủy kết quả"
            okButtonProps={{ danger: true }}
            cancelText="Không"
            confirmLoading={busy}
            destroyOnHidden
          >
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Kết quả hiện tại không còn hiệu lực. Việc này được ghi vào nhật ký và báo cho cán bộ cùng người thẩm định." />
            <Form
              form={form}
              layout="vertical"
              onFinish={async (v) => {
                const ok = await run(async () => void (await apiCall('POST', `/evaluation/evaluations/${evaluationId}/revoke`, { reasonCode: v.reasonCode, note: v.note.trim() })), { success: 'Đã hủy kết quả, hồ sơ về bước giao mục tiêu' });
                if (ok) setOpen(false);
              }}
            >
              <Form.Item name="reasonCode" label="Lý do" rules={[{ required: true, message: 'Chọn lý do' }]}>
                <Select options={Object.entries(REVOCATION_LABELS).map(([value, label]) => ({ value, label }))} placeholder="Chọn lý do" />
              </Form.Item>
              <Form.Item name="note" label="Căn cứ cụ thể" rules={[{ required: true, whitespace: true, min: 10, message: 'Nêu căn cứ (ít nhất 10 ký tự)' }]}>
                <Input.TextArea rows={4} maxLength={2000} placeholder="Số liệu, văn bản, kết luận làm căn cứ hủy" />
              </Form.Item>
            </Form>
          </Modal>
        </Card>
      )}

      {revocations.length > 0 && (
        <Card size="small" title={`Lịch sử hủy kết quả (${revocations.length})`} style={{ marginTop: 16 }}>
          <Table<EvaluationRevocation>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={revocations}
            columns={[
              { title: 'Thời điểm', render: (_: unknown, r) => dateTimeText(r.revokedAt) },
              { title: 'Lý do', render: (_: unknown, r) => REVOCATION_LABELS[r.reasonCode] },
              { title: 'Căn cứ', dataIndex: 'reason' },
              {
                title: 'Kết quả đã hủy',
                render: (_: unknown, r) => {
                  const total = r.previous.totalScore;
                  const rating = r.previous.rating;
                  return total == null ? '–' : `${total} điểm${rating ? `, ${RATING_LABELS[rating]}` : ''}`;
                },
              },
            ]}
          />
        </Card>
      )}
    </>
  );
}
