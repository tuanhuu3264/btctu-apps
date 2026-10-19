'use client';

import {
  AimOutlined,
  ApartmentOutlined,
  AuditOutlined,
  SafetyCertificateOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CarryOutOutlined,
  FileDoneOutlined,
  FolderOpenOutlined,
  IdcardOutlined,
  LogoutOutlined,
  ProjectOutlined,
  StarFilled,
  TeamOutlined,
  UsergroupAddOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space, Tag, Typography } from 'antd';
import IdleGuard from '@/components/idle-guard';
import NotificationBell from '@/components/notification-bell';
import SecurityButton from '@/components/security-modal';
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
function menuItems(permissions: string[], linked: boolean): Item[] {
  const can = (p: string) => permissions.includes(p);
  const items: (Item | false)[] = [
    { key: '/', icon: <DashboardOutlined />, label: <Link href="/">Tổng quan</Link> },
    { key: '/org-chart', icon: <ApartmentOutlined />, label: <Link href="/org-chart">Sơ đồ tổ chức</Link> },
    can('org:manage') && { key: '/organization', icon: <IdcardOutlined />, label: <Link href="/organization">Quản lý cán bộ</Link> },
    can('catalog:read') && { key: '/catalog', icon: <AppstoreOutlined />, label: <Link href="/catalog">Danh mục nhiệm vụ</Link> },
    can('task:read') && { key: '/tasks', icon: <CarryOutOutlined />, label: <Link href="/tasks">Việc được giao</Link> },
    linked && { key: '/projects', icon: <ProjectOutlined />, label: <Link href="/projects">Đề án, dự án</Link> },
    linked && { key: '/meetings', icon: <CalendarOutlined />, label: <Link href="/meetings">Lịch họp</Link> },
    can('task:read') && { key: '/okr', icon: <AimOutlined />, label: <Link href="/okr">OKR theo dõi</Link> },
    (can('document:read') || can('task:read')) && { key: '/documents', icon: <FolderOpenOutlined />, label: <Link href="/documents">Quản lý tài liệu</Link> },
    can('evaluation:read') && { key: '/evaluations', icon: <FileDoneOutlined />, label: <Link href="/evaluations">Đánh giá theo kỳ</Link> },
    can('evaluation:read') && { key: '/unit-evaluations', icon: <UsergroupAddOutlined />, label: <Link href="/unit-evaluations">Đánh giá tập thể</Link> },
    can('report:read') && { key: '/reports', icon: <BarChartOutlined />, label: <Link href="/reports">Báo cáo</Link> },
    can('audit:read') && { key: '/audit-logs', icon: <AuditOutlined />, label: <Link href="/audit-logs">Nhật ký hoạt động</Link> },
    (can('access-review:manage') || can('access-review:confirm') || can('access-review:oversee')) && { key: '/access-reviews', icon: <SafetyCertificateOutlined />, label: <Link href="/access-reviews">Rà soát quyền</Link> },
    can('account:read') && { key: '/accounts', icon: <TeamOutlined />, label: <Link href="/accounts">Tài khoản và vai trò</Link> },
  ];
  return items.filter((i): i is Item => i !== false);
}

export default function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const selected = ['/org-chart', '/organization', '/catalog', '/tasks', '/projects', '/meetings', '/okr', '/documents', '/evaluations', '/unit-evaluations', '/reports', '/audit-logs', '/access-reviews', '/accounts'].find((p) => pathname.startsWith(p)) ?? '/';

  async function logout() {
    await apiCall('POST', '/auth/logout').catch(() => null);
    router.push('/login');
    router.refresh();
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <IdleGuard />
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
        <Menu mode="inline" selectedKeys={[selected]} items={menuItems(me.permissions, !!me.personId)} style={{ borderInlineEnd: 0 }} />
      </Sider>
      <Layout>
        <Header className="app-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '0 24px' }}>
          <Space>
            {me.personId && <NotificationBell />}
            <Avatar style={{ background: '#c8102e' }} icon={<UserOutlined />} />
            <Typography.Text strong>{me.username}</Typography.Text>
            {me.roles.length > 0 ? me.roles.map((r) => <Tag key={r} color="red">{ROLE_LABELS[r] ?? r}</Tag>) : <Tag>chưa có vai trò</Tag>}
            <SecurityButton />
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
