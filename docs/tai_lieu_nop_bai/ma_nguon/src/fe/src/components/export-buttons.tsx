'use client';

import { DownloadOutlined } from '@ant-design/icons';
import { Button, Space } from 'antd';
import { API_URL } from '@/lib/client';

/** Hai nút tải danh sách ra Excel và PDF. `path` là đường dẫn API (kèm bộ lọc nếu có), tham số `format` do nút thêm vào. */
export default function ExportButtons({ path }: { path: string }) {
  const href = (format: 'xlsx' | 'pdf') => `${API_URL}${path}${path.includes('?') ? '&' : '?'}format=${format}`;
  return (
    <Space>
      <Button icon={<DownloadOutlined />} href={href('xlsx')}>
        Xuất Excel
      </Button>
      <Button icon={<DownloadOutlined />} href={href('pdf')}>
        Xuất PDF
      </Button>
    </Space>
  );
}
