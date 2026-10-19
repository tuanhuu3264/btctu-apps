'use client';

import { CopyOutlined, DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Space, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';

export interface MfaEnrollment {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

/**
 * Đăng ký thiết bị xác thực (TOTP, ADR-048): quét mã QR hoặc nhập khóa vào ứng dụng Authenticator, nhập mã đầu tiên,
 * rồi lưu các mã khôi phục (chỉ hiện một lần). Dùng chung cho màn hình đăng nhập và cửa sổ Bảo mật tài khoản.
 */
export default function MfaEnroll({
  load,
  confirm,
  onDone,
  doneText = 'Tôi đã lưu mã khôi phục',
}: {
  load: () => Promise<MfaEnrollment>;
  confirm: (code: string) => Promise<string[]>;
  onDone: () => void;
  doneText?: string;
}) {
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    load()
      .then((e) => alive && setEnrollment(e))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Không bắt đầu được đăng ký'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(values: { code: string }) {
    setBusy(true);
    setError(null);
    try {
      setCodes(await confirm(values.code));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xác nhận thất bại');
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    const text = codes.join('\n');
    return (
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert type="warning" showIcon message="Lưu các mã khôi phục này ở nơi an toàn" description="Mỗi mã dùng được một lần khi mất thiết bị. Hệ thống không hiển thị lại." />
        <pre data-testid="recovery-codes" style={{ background: '#fafafa', border: '1px solid #eee', padding: 12, margin: 0, columns: 2 }}>{text}</pre>
        <Space>
          <Button icon={<CopyOutlined />} onClick={() => void navigator.clipboard?.writeText(text)}>
            Sao chép
          </Button>
          <Button
            icon={<DownloadOutlined />}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([text + '\n'], { type: 'text/plain' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = 'ma-khoi-phuc-kpi.txt';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Tải về
          </Button>
        </Space>
        <Button type="primary" block onClick={onDone}>
          {doneText}
        </Button>
      </Space>
    );
  }

  if (!enrollment) return error ? <Alert type="error" showIcon message={error} /> : <Spin />;

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Text>1. Mở ứng dụng Authenticator (Google, Microsoft, FreeOTP...) và quét mã QR:</Typography.Text>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={enrollment.qrDataUrl} alt="Mã QR đăng ký xác thực" width={200} height={200} style={{ alignSelf: 'center' }} />
      <Typography.Text type="secondary">
        Không quét được? Nhập khóa: <Typography.Text code copyable>{enrollment.secret}</Typography.Text>
      </Typography.Text>
      <Typography.Text>2. Nhập mã 6 số do ứng dụng hiển thị:</Typography.Text>
      {error && <Alert type="error" showIcon message={error} />}
      <Form layout="vertical" onFinish={submit} requiredMark={false}>
        <Form.Item name="code" rules={[{ required: true, pattern: /^\s*\d{6}\s*$/, message: 'Nhập đủ 6 chữ số' }]}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" autoFocus />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={busy}>
          Xác nhận
        </Button>
      </Form>
    </Space>
  );
}
