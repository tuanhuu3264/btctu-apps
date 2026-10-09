'use client';

import { Typography } from 'antd';
import type { ReactNode } from 'react';

/**
 * Tiêu đề trang. Là component client vì `Typography.Title` là thuộc tính con của component client,
 * không dùng được trực tiếp trong server component.
 */
export default function PageTitle({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return (
    <Typography.Title level={3} className="page-title" style={flush ? { margin: 0 } : undefined}>
      {children}
    </Typography.Title>
  );
}
