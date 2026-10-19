import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'KPI/OKR – Ban Tổ chức Tỉnh ủy',
  description: 'Quản lý, đánh giá kết quả thực hiện nhiệm vụ bằng KPI/OKR',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="vi">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
