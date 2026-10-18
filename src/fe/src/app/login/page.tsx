'use client';

import { LockOutlined, SafetyOutlined, StarFilled, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import MfaEnroll from '@/components/mfa-enroll';
import { apiCall } from '@/lib/client';

interface MfaPending {
  mfa: 'VERIFY' | 'ENROLL';
  challenge: string;
  expiresInSeconds: number;
}

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Về từ phiên đã tự đóng vì không thao tác (ADR-057).
  const idleClosed = useSyncExternalStore(
    () => () => undefined,
    () => new URLSearchParams(window.location.search).get('reason') === 'idle',
    () => false,
  );
  // Mật khẩu đúng nhưng còn bước xác thực nhiều lớp (ADR-048).
  const [pending, setPending] = useState<MfaPending | null>(null);

  function enter() {
    router.push('/');
    router.refresh();
  }

  async function verify(values: { code: string }) {
    setBusy(true);
    setError(null);
    try {
      await apiCall('POST', '/auth/mfa/verify', { challenge: pending!.challenge, code: values.code });
      enter();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xác thực thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function onFinish(values: { username: string; password: string }) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiCall<MfaPending | { id: string }>('POST', '/auth/login', values);
      if (result && 'mfa' in result) {
        setPending(result);
        return;
      }
      enter();
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
          {pending ? 'Xác thực nhiều lớp' : 'Đăng nhập'}
        </Typography.Title>
        {pending?.mfa === 'ENROLL' ? (
          <>
            <Alert type="info" showIcon style={{ marginBottom: 16 }} message="Vai trò của bạn bắt buộc dùng xác thực nhiều lớp. Đăng ký thiết bị để tiếp tục." />
            <MfaEnroll
              load={async () => (await apiCall<never>('POST', '/auth/mfa/enroll/start', { challenge: pending.challenge }))!}
              confirm={async (code) => (await apiCall<{ recoveryCodes: string[] }>('POST', '/auth/mfa/enroll/confirm', { challenge: pending.challenge, code }))!.recoveryCodes}
              onDone={enter}
              doneText="Tôi đã lưu mã khôi phục, vào hệ thống"
            />
          </>
        ) : pending ? (
          <>
            <Typography.Paragraph type="secondary">Nhập mã 6 số từ ứng dụng Authenticator, hoặc một mã khôi phục (xxxxx-xxxxx).</Typography.Paragraph>
            {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
            <Form layout="vertical" onFinish={verify} requiredMark={false}>
              <Form.Item name="code" rules={[{ required: true, message: 'Nhập mã xác thực' }]}>
                <Input prefix={<SafetyOutlined />} inputMode="text" autoComplete="one-time-code" maxLength={16} autoFocus placeholder="123456" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={busy}>
                Xác nhận
              </Button>
              <Button type="link" block onClick={() => { setPending(null); setError(null); }}>
                Quay lại
              </Button>
            </Form>
          </>
        ) : (
        <>
        <Typography.Paragraph type="secondary">Quản lý, đánh giá kết quả thực hiện nhiệm vụ bằng KPI/OKR</Typography.Paragraph>
        {idleClosed && !error && <Alert type="warning" showIcon style={{ marginBottom: 16 }} message="Phiên làm việc đã đóng do không thao tác. Vui lòng đăng nhập lại." />}
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
        </>
        )}
      </Card>
      </div>
    </div>
  );
}
