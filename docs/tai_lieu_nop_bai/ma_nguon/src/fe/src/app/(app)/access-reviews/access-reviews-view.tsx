'use client';

import { BellOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Progress, Space, Table, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AccessReviewDetail, AccessReviewItem, AccessReviewSuggestion, AccessReviewView } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { dateTimeText, ROLE_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-action';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const DECISION_TAG = {
  KEEP: <Tag color="green">Giữ</Tag>,
  REVOKE: <Tag color="red">Thu hồi</Tag>,
};

interface Props {
  reviews: AccessReviewView[];
  detail: AccessReviewDetail | null;
  suggestion: AccessReviewSuggestion | null;
  canManage: boolean;
  canExport: boolean;
}

/** Hộp thoại tạo đợt rà soát. Chỉ được dựng khi đang mở. */
function CreateModal({ suggestion, onClose }: { suggestion: AccessReviewSuggestion | null; onClose: () => void }) {
  const { run, busy } = useAction();
  const router = useRouter();
  const [form] = Form.useForm<{ year: number; quarter: number; dueDate?: string; note?: string }>();
  return (
    <Modal
      open
      title="Tạo đợt rà soát quyền"
      okText="Tạo đợt"
      cancelText="Hủy"
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          let createdId: string | null = null;
          const ok = await run(
            async () => {
              const created = await apiCall<AccessReviewView>('POST', '/access-reviews', { ...v, dueDate: v.dueDate || undefined, note: v.note || undefined });
              createdId = created?.id ?? null;
            },
            { success: 'Đã tạo đợt rà soát và gửi thông báo cho người xác nhận' },
          );
          if (ok) {
            onClose();
            if (createdId) router.push(`/access-reviews?open=${createdId}`);
          }
        })
      }
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Hệ thống chụp mọi vai trò đang có hiệu lực. Mỗi mục giao cho lãnh đạo đơn vị của cán bộ; mục không có lãnh đạo (tài khoản quản trị, Trưởng ban) do quản trị dữ liệu xác nhận." />
      <Form form={form} layout="vertical" initialValues={{ year: suggestion?.year ?? new Date().getFullYear(), quarter: suggestion?.quarter ?? 1 }}>
        <Space>
          <Form.Item name="year" label="Năm" rules={[{ required: true }]}>
            <InputNumber min={2000} max={2100} />
          </Form.Item>
          <Form.Item name="quarter" label="Quý" rules={[{ required: true }]}>
            <InputNumber min={1} max={4} />
          </Form.Item>
        </Space>
        <Form.Item name="dueDate" label="Hạn xác nhận" extra="Để trống thì 14 ngày kể từ hôm nay" rules={[{ pattern: /^\d{4}-\d{2}-\d{2}$/, message: 'Dạng 2026-10-31' }]}>
          <Input placeholder="2026-10-31" maxLength={10} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Hộp nhập lý do thu hồi. */
function RevokeModal({ item, onClose }: { item: AccessReviewItem; onClose: () => void }) {
  const { run, busy } = useAction();
  const [form] = Form.useForm<{ note: string }>();
  return (
    <Modal
      open
      title={`Thu hồi vai trò ${ROLE_LABELS[item.role] ?? item.role} của ${item.personName ?? item.username}`}
      okText="Thu hồi ngay"
      okButtonProps={{ danger: true }}
      cancelText="Hủy"
      confirmLoading={busy}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          if (await run(async () => void (await apiCall('POST', `/access-reviews/items/${item.id}/decision`, { decision: 'REVOKE', note: v.note })), { success: 'Đã thu hồi vai trò' })) onClose();
        })
      }
    >
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Vai trò bị thu hồi ngay và không đổi lại được trong đợt này." />
      <Form form={form} layout="vertical">
        <Form.Item name="note" label="Lý do" rules={[{ required: true, whitespace: true, min: 3, message: 'Nêu lý do (từ 3 ký tự)' }]}>
          <Input.TextArea rows={3} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ReviewDetailView({ detail, canManage, canExport }: { detail: AccessReviewDetail; canManage: boolean; canExport: boolean }) {
  const { run, busy } = useAction();
  const router = useRouter();
  const [revoking, setRevoking] = useState<AccessReviewItem | null>(null);
  const { review, items } = detail;
  const open = review.status === 'OPEN';

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Button onClick={() => router.push('/access-reviews')}>← Danh sách đợt</Button>
        {canExport && (
          <Button icon={<DownloadOutlined />} href={`${API_URL}/access-reviews/${review.id}/export`}>
            Xuất Excel
          </Button>
        )}
        {canManage && open && (
          <>
            <Button icon={<BellOutlined />} loading={busy} onClick={() => run(async () => void (await apiCall('POST', `/access-reviews/${review.id}/remind`)), { success: 'Đã gửi nhắc' })}>
              Nhắc người chưa xác nhận
            </Button>
            <Popconfirm
              title={`Đóng đợt ${review.label}?`}
              description="Các mục chưa xác nhận được giữ nguyên, không tự thu hồi. Đóng rồi không xác nhận thêm được."
              okText="Đóng đợt"
              cancelText="Hủy"
              onConfirm={() => run(async () => void (await apiCall('POST', `/access-reviews/${review.id}/close`)), { success: 'Đã đóng đợt' })}
            >
              <Button danger loading={busy}>
                Đóng đợt
              </Button>
            </Popconfirm>
          </>
        )}
      </Space>

      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, md: 2 }}
        items={[
          { key: 'label', label: 'Đợt', children: <strong>{review.label}</strong> },
          { key: 'status', label: 'Trạng thái', children: open ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng {review.closedAt ? dateTimeText(review.closedAt) : ''}</Tag> },
          { key: 'due', label: 'Hạn xác nhận', children: <>{review.dueDate} {review.overdue && <Tag color="red">Quá hạn</Tag>}</> },
          { key: 'progress', label: 'Tiến độ', children: <Progress percent={review.counts.total === 0 ? 0 : Math.round((review.counts.decided / review.counts.total) * 100)} size="small" format={() => `${review.counts.decided}/${review.counts.total}`} /> },
          { key: 'keep', label: 'Giữ / Thu hồi / Chưa xác nhận', children: `${review.counts.keep} / ${review.counts.revoke} / ${review.counts.pending}` },
          { key: 'note', label: 'Ghi chú', children: review.note ?? '–' },
        ]}
      />

      <Table<AccessReviewDetail['items'][number]>
        rowKey="id"
        size="small"
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        dataSource={items}
        scroll={{ x: 1100 }}
        locale={{ emptyText: 'Không có mục nào' }}
        columns={[
          { title: 'Tài khoản', dataIndex: 'username', width: 150 },
          { title: 'Cán bộ', render: (_: unknown, i) => (i.personName ? `${i.personName}${i.positionTitle ? ` – ${i.positionTitle}` : ''}` : <Tag>không gắn cán bộ</Tag>) },
          { title: 'Đơn vị', dataIndex: 'unitName', render: (v: string | null) => v ?? '–' },
          { title: 'Vai trò', dataIndex: 'role', width: 170, render: (r: string) => ROLE_LABELS[r] ?? r },
          { title: 'Hết hạn', dataIndex: 'roleValidTo', width: 120, render: (t: string | null) => (t ? dateTimeText(t) : 'không hết hạn') },
          {
            title: 'Người xác nhận',
            render: (_: unknown, i) => (i.reviewerKind === 'LEADER' ? (i.reviewerName ?? 'Lãnh đạo') : <Tag color="purple">Quản trị dữ liệu</Tag>),
          },
          {
            title: 'Quyết định',
            width: 210,
            render: (_: unknown, i) =>
              i.decision ? (
                <Space orientation="vertical" size={0}>
                  <span>
                    {DECISION_TAG[i.decision]} {i.decidedAt ? dateTimeText(i.decidedAt) : ''}
                  </span>
                  {i.note && <Typography.Text type="secondary">{i.note}</Typography.Text>}
                </Space>
              ) : (
                <Tag color="orange">Chưa xác nhận</Tag>
              ),
          },
          {
            title: '',
            width: 190,
            render: (_: unknown, i) =>
              i.canDecide ? (
                <Space>
                  <Button size="small" type={i.decision === 'KEEP' ? 'primary' : 'default'} loading={busy} onClick={() => run(async () => void (await apiCall('POST', `/access-reviews/items/${i.id}/decision`, { decision: 'KEEP' })), { success: 'Đã ghi: giữ vai trò' })}>
                    Giữ
                  </Button>
                  <Button size="small" danger onClick={() => setRevoking(i)}>
                    Thu hồi
                  </Button>
                </Space>
              ) : null,
          },
        ]}
      />
      {revoking && <RevokeModal item={revoking} onClose={() => setRevoking(null)} />}
    </Space>
  );
}

export default function AccessReviewsView({ reviews, detail, suggestion, canManage, canExport }: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  if (detail) return <ReviewDetailView detail={detail} canManage={canManage} canExport={canExport} />;

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      {canManage && suggestion && !suggestion.exists && (
        <Alert
          type="warning"
          showIcon
          message={`Chưa có đợt rà soát quyền ${suggestion.label}`}
          description="Nên tạo đợt đầu mỗi quý để lãnh đạo xác nhận các vai trò đang có."
          action={
            <Button type="primary" size="small" onClick={() => setCreating(true)}>
              Tạo đợt
            </Button>
          }
        />
      )}
      {canManage && (
        <div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Tạo đợt rà soát
          </Button>
        </div>
      )}
      <Table<AccessReviewView>
        rowKey="id"
        size="middle"
        pagination={false}
        dataSource={reviews}
        locale={{ emptyText: 'Chưa có đợt rà soát nào' }}
        columns={[
          { title: 'Đợt', dataIndex: 'label' },
          { title: 'Trạng thái', dataIndex: 'status', width: 130, render: (s: AccessReviewView['status']) => (s === 'OPEN' ? <Tag color="green">Đang mở</Tag> : <Tag>Đã đóng</Tag>) },
          { title: 'Hạn', dataIndex: 'dueDate', width: 130, render: (d: string, r) => <>{d} {r.overdue && <Tag color="red">Quá hạn</Tag>}</> },
          { title: 'Tiến độ', width: 170, render: (_: unknown, r) => `${r.counts.decided}/${r.counts.total} (còn ${r.counts.pending})` },
          { title: 'Thu hồi', width: 100, render: (_: unknown, r) => r.counts.revoke },
          {
            title: '',
            width: 100,
            render: (_: unknown, r) => (
              <Button size="small" onClick={() => router.push(`/access-reviews?open=${r.id}`)}>
                Mở
              </Button>
            ),
          },
        ]}
      />
      {creating && <CreateModal suggestion={suggestion} onClose={() => setCreating(false)} />}
    </Space>
  );
}
