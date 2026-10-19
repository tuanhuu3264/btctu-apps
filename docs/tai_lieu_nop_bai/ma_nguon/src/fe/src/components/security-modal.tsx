'use client';

import { SafetyOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Form, Input, Modal, Space, Spin, Tag, Typography } from 'antd';
import { useState } from 'react';
import MfaEnroll from '@/components/mfa-enroll';
import type { MfaEnrollment } from '@/components/mfa-enroll';
import { apiCall } from '@/lib/client';
import { useRemote } from '@/lib/use-remote';

interface MfaStatus {
  mode: 'off' | 'optional' | 'required';
  enabled: boolean;
  required: boolean;
  recoveryCodesLeft: number;
}

type View = 'status' | 'enroll' | 'disable' | 'recovery';

/** Cửa sổ "Bảo mật tài khoản": trạng thái xác thực nhiều lớp, đăng ký, tắt, tạo lại mã khôi phục (ADR-048). */
export default function SecurityButton() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('status');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const status = useRemote<MfaStatus>(open ? '/auth/mfa' : null, version);

  function close() {
    setOpen(false);
    setView('status');
    setError(null);
    setNewCodes(null);
  }

  async function submit(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Thao tác thất bại');
    } finally {
      setBusy(false);
    }
  }

  const s = status.data;
  return (
    <>
      <Button icon={<SafetyOutlined />} onClick={() => setOpen(true)}>
        Bảo mật
      </Button>
      <Modal title="Bảo mật tài khoản" open={open} onCancel={close} footer={null} destroyOnHidden>
        {status.error && <Alert type="error" showIcon message={status.error} />}
        {!s && !status.error && <Spin />}
        {s && view === 'status' && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Xác thực nhiều lớp">
                {s.mode === 'off' ? <Tag>Hệ thống không bật</Tag> : s.enabled ? <Tag color="green">Đã bật</Tag> : <Tag>Chưa bật</Tag>}
              </Descriptions.Item>
              {s.enabled && <Descriptions.Item label="Mã khôi phục còn lại">{s.recoveryCodesLeft}</Descriptions.Item>}
              {s.required && <Descriptions.Item label="Yêu cầu">Bắt buộc với vai trò của bạn</Descriptions.Item>}
            </Descriptions>
            {newCodes && (
              <Alert
                type="warning"
                showIcon
                message="Mã khôi phục mới (hiện một lần)"
                description={<pre style={{ margin: 0 }}>{newCodes.join('\n')}</pre>}
              />
            )}
            {s.mode !== 'off' && !s.enabled && (
              <Button type="primary" onClick={() => setView('enroll')}>
                Đăng ký ứng dụng Authenticator
              </Button>
            )}
            {s.enabled && (
              <Space>
                <Button onClick={() => { setError(null); setView('recovery'); }}>Tạo lại mã khôi phục</Button>
                {!s.required && (
                  <Button danger onClick={() => { setError(null); setView('disable'); }}>
                    Tắt xác thực nhiều lớp
                  </Button>
                )}
              </Space>
            )}
          </Space>
        )}
        {view === 'enroll' && (
          <MfaEnroll
            load={async () => (await apiCall<MfaEnrollment>('POST', '/auth/mfa/setup/start'))!}
            confirm={async (code) => (await apiCall<{ recoveryCodes: string[] }>('POST', '/auth/mfa/setup/confirm', { code }))!.recoveryCodes}
            onDone={() => {
              setView('status');
              setVersion((v) => v + 1);
            }}
          />
        )}
        {(view === 'disable' || view === 'recovery') && (
          <Form
            layout="vertical"
            requiredMark={false}
            onFinish={(v: { password?: string; code: string }) =>
              submit(async () => {
                if (view === 'disable') {
                  await apiCall('POST', '/auth/mfa/disable', { password: v.password, code: v.code });
                } else {
                  setNewCodes((await apiCall<{ recoveryCodes: string[] }>('POST', '/auth/mfa/recovery-codes', { code: v.code }))!.recoveryCodes);
                }
                setView('status');
                setVersion((n) => n + 1);
              })
            }
          >
            <Typography.Paragraph type="secondary">
              {view === 'disable' ? 'Nhập mật khẩu và mã xác thực hiện tại để tắt.' : 'Nhập mã xác thực hiện tại. Các mã khôi phục cũ sẽ mất hiệu lực.'}
            </Typography.Paragraph>
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
            {view === 'disable' && (
              <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
                <Input.Password autoComplete="current-password" maxLength={256} />
              </Form.Item>
            )}
            <Form.Item name="code" label="Mã xác thực" rules={[{ required: true, message: 'Nhập mã' }]}>
              <Input autoComplete="one-time-code" maxLength={16} autoFocus />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={busy}>
                Xác nhận
              </Button>
              <Button onClick={() => setView('status')}>Hủy</Button>
            </Space>
          </Form>
        )}
      </Modal>
    </>
  );
}
