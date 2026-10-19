'use client';

import { App, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import type { ReactNode } from 'react';

/** Màu chủ đạo đỏ - trắng. Màu ngữ nghĩa (xanh thành công, vàng cảnh báo) giữ nguyên để không gây hiểu nhầm. */
const RED = '#c8102e';
const RED_DARK = '#9b0d24';
const RED_TINT = '#fdf0f2';

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={viVN}
      theme={{
        token: {
          colorPrimary: RED,
          colorInfo: RED,
          colorSuccess: '#2e9e5b',
          colorWarning: '#f5b800',
          colorLink: RED,
          colorLinkHover: RED_DARK,
          colorBgLayout: '#faf7f7',
          colorBorderSecondary: '#f3e4e6',
          borderRadius: 8,
          fontFamily: "'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif",
        },
        components: {
          Layout: { headerBg: '#ffffff', siderBg: '#ffffff', bodyBg: '#faf7f7' },
          Menu: {
            itemSelectedBg: RED_TINT,
            itemSelectedColor: RED,
            itemHoverBg: '#fff7f8',
            itemHoverColor: RED_DARK,
            itemBorderRadius: 8,
            itemMarginInline: 10,
          },
          Table: { headerBg: RED_TINT, headerColor: RED_DARK, rowHoverBg: '#fffafa', borderColor: '#f3e4e6' },
          Card: { headerFontSize: 15 },
          Tabs: { itemSelectedColor: RED, itemHoverColor: RED_DARK, inkBarColor: RED },
          Button: { primaryShadow: '0 2px 0 rgba(200, 16, 46, 0.12)' },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  );
}
