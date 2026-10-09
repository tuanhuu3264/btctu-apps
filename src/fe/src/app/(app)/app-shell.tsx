'use client';

import {
  ApartmentOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  CarryOutOutlined,
  FileDoneOutlined,
  FolderOpenOutlined,
  IdcardOutlined,
  LogoutOutlined,
  StarFilled,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import NotificationBell from '@/components/notification-bell';
import type { MenuProps } from 'antd';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Me } from '@/lib/api';
import { apiCall } from '@/lib/client';
import { ROLE_LABELS } from '@/lib/labels';

const { Header, Sider, Content } = Layout;

type Item = Required<MenuProps>['items'][number];

/** Mục menu hiện theo quyền của người đăng nhập. Máy chủ vẫn kiểm tra lại mọi thao tác. */
function menuItems(permissions: string[]): Item[] {
  const can = (p: string) => permissions.includes(p);
  const items: (Item | false)[] = [
    { key: '/', icon: <DashboardOutlined />, label: <Link href="/">Tổng quan</Link> },
    { key: '/org-chart', icon: <ApartmentOutlined />, label: <Link href="/org-chart">Sơ đồ tổ chức</Link> },
    can('org:manage') && { key: '/organization', icon: <IdcardOutlined />, label: <Link href="/organization">Quản lý cán bộ</Link> },
    can('catalog:read') && { key: '/catalog', icon: <AppstoreOutlined />, label: <Link href="/catalog">Danh mục nhiệm vụ</Link> },
    can('task:read') && { key: '/tasks', icon: <CarryOutOutlined />, label: <Link href="/tasks">Việc được giao</Link> },
    (can('document:read') || can('task:read')) && { key: '/documents', icon: <FolderOpenOutlined />, label: <Link href="/documents">Quản lý tài liệu</Link> },
    can('evaluation:read') && { key: '/evaluations', icon: <FileDoneOutlined />, label: <Link href="/evaluations">Đánh giá theo kỳ</Link> },
    can('report:read') && { key: '/reports', icon: <BarChartOutlined />, label: <Link href="/reports">Báo cáo</Link> },
    can('account:read') && { key: '/accounts', icon: <TeamOutlined />, label: <Link href="/accounts">Tài khoản và vai trò</Link> },
  ];
  return items.filter((i): i is Item => i !== false);
}

export default function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const selected = ['/org-chart', '/organization', '/catalog', '/tasks', '/documents', '/evaluations', '/reports', '/accounts'].find((p) => pathname.startsWith(p)) ?? '/';

  async function logout() {
    await apiCall('POST', '/auth/logout').catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} width={248} theme="light" style={{ borderRight: '1px solid #f3e4e6' }}>
        <div className="brand">
          <div className="brand-mark">
            <StarFilled />
          </div>
          <div>
            <div className="brand-title">KPI/OKR</div>
            <div className="brand-sub">Ban Tổ chức Tỉnh ủy Đắk Lắk</div>
          </div>
        </div>
        <Menu mode="inline" selectedKeys={[selected]} items={menuItems(me.permissions)} style={{ borderInlineEnd: 0 }} />
      </Sider>
      <Layout>
        <Header className="app-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 24px' }}>
          <Space>
            {me.personId && <NotificationBell />}
            <Avatar style={{ background: '#c8102e' }} icon={<UserOutlined />} />
            <Typography.Text strong>{me.username}</Typography.Text>
            {me.roles.length > 0 ? me.roles.map((r) => <Tag key={r} color="red">{ROLE_LABELS[r] ?? r}</Tag>) : <Tag>chưa có vai trò</Tag>}
            <Button icon={<LogoutOutlined />} onClick={logout}>
              Đăng xuất
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
