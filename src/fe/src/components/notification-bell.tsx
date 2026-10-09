'use client';

import { BellOutlined } from '@ant-design/icons';
import { Alert, Badge, Button, Drawer, Empty, List, Space, Switch, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NotificationPage, NotificationItem } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { dateTimeText } from '@/lib/labels';
import { useRemote } from '@/lib/use-remote';

const POLL_MS = 60_000;

/** Danh sách thông báo trong ngăn kéo. Chỉ được dựng khi đang mở nên chỉ tải khi cần (ADR-029). */
function NotificationList({ version, onChanged, onNavigate }: { version: number; onChanged: () => void; onNavigate: () => void }) {
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [local, setLocal] = useState(0);
  const { data, error, loading } = useRemote<NotificationPage>(`/notifications?pageSize=30${unreadOnly ? '&unread=1' : ''}`, version + local);

  async function open(n: NotificationItem) {
    if (!n.readAt) {
      await apiCall('POST', `/notifications/${n.id}/read`).catch(() => null);
      onChanged();
    }
    if (n.link) {
      onNavigate();
      router.push(n.link);
    } else {
      setLocal((v) => v + 1);
    }
  }

  async function readAll() {
    await apiCall('POST', '/notifications/read-all').catch(() => null);
    onChanged();
    setLocal((v) => v + 1);
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
        <Space>
          <Switch size="small" checked={unreadOnly} onChange={setUnreadOnly} aria-label="Chỉ xem chưa đọc" />
          <span>Chỉ chưa đọc</span>
        </Space>
        <Button size="small" onClick={readAll} disabled={(data?.unread ?? 0) === 0}>
          Đánh dấu đã đọc tất cả
        </Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      <List
        loading={loading && data === null}
        dataSource={data?.items ?? []}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={unreadOnly ? 'Không có thông báo chưa đọc' : 'Chưa có thông báo nào'} /> }}
        renderItem={(n) => (
          <List.Item style={{ cursor: 'pointer', padding: '10px 4px' }} onClick={() => open(n)}>
            <List.Item.Meta
              avatar={<Badge status={n.readAt ? 'default' : 'error'} style={{ marginTop: 8 }} />}
              title={<Typography.Text strong={!n.readAt}>{n.title}</Typography.Text>}
              description={dateTimeText(n.createdAt)}
            />
          </List.Item>
        )}
      />
      {data && data.total > data.items.length && <Typography.Text type="secondary">Hiện {data.items.length} thông báo mới nhất trên tổng {data.total}.</Typography.Text>}
    </Space>
  );
}

/** Chuông thông báo ở đầu trang: số chưa đọc cập nhật mỗi phút khi tab đang mở (ADR-029 mục 7). */
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const count = useRemote<{ unread: number }>('/notifications/unread-count', version);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') setVersion((n) => n + 1);
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const unread = count.data?.unread ?? 0;
  return (
    <>
      <Badge count={unread} overflowCount={99} size="small">
        <Button
          shape="circle"
          icon={<BellOutlined />}
          aria-label={unread > 0 ? `Thông báo, ${unread} chưa đọc` : 'Thông báo'}
          onClick={() => {
            setVersion((n) => n + 1);
            setOpen(true);
          }}
        />
      </Badge>
      <Drawer title="Thông báo" open={open} onClose={() => setOpen(false)} size={420} destroyOnHidden>
        <NotificationList version={version} onChanged={() => setVersion((n) => n + 1)} onNavigate={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
