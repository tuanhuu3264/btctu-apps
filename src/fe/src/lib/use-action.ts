'use client';

import { App } from 'antd';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Chạy một thao tác gọi API: khóa nút khi đang chạy, hiện lỗi của máy chủ bằng thông báo,
 * làm mới dữ liệu trang khi xong. Trả về true nếu thành công.
 */
export function useAction() {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, options: { refresh?: boolean; success?: string } = {}): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      if (options.success) message.success(options.success);
      if (options.refresh !== false) router.refresh();
      return true;
    } catch (e) {
      message.error({ content: e instanceof Error ? e.message : 'Lỗi không xác định', duration: 6 });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { run, busy, router };
}
