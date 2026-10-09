'use client';

import { LockOutlined, StarFilled, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setBusy(true);
    setError(null);
    try {
      await apiCall('POST', '/auth/login', values);
      router.push('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof TypeError ? 'Không kết nối được máy chủ' : e instanceof Error ? e.message : 'Đăng nhập thất bại');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <StarFilled style={{ fontSize: 44, marginBottom: 20 }} />
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.2 }}>Hệ thống KPI/OKR</div>
        <div style={{ fontSize: 18, marginTop: 8, opacity: 0.92 }}>Ban Tổ chức Tỉnh ủy Đắk Lắk</div>
        <div style={{ marginTop: 28, maxWidth: 440, fontSize: 15, lineHeight: 1.7, opacity: 0.85 }}>
          Giao việc, theo dõi tiến độ và đánh giá kết quả thực hiện nhiệm vụ của cán bộ theo Nghị định 335/2025/NĐ-CP.
        </div>
      </div>
      <div className="login-panel">
      <Card style={{ width: 380, borderTop: '4px solid #f5b800' }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Đăng nhập
        </Typography.Title>
        <Typography.Paragraph type="secondary">Quản lý, đánh giá kết quả thực hiện nhiệm vụ bằng KPI/OKR</Typography.Paragraph>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, message: 'Nhập tên đăng nhập' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" maxLength={64} autoFocus />
          </Form.Item>
          <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" maxLength={256} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>
            Đăng nhập
          </Button>
        </Form>
      </Card>
      </div>
    </div>
  );
}
