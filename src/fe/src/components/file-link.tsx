'use client';

import { DownloadOutlined, EyeOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Button, Modal, Space } from 'antd';
import { useState } from 'react';
import { fileSizeText } from '@/lib/labels';

/** Kiểu nội dung trình duyệt xem được ngay (khớp danh sách ở máy chủ, ADR-026). Tệp Office chỉ tải về. */
const VIEWABLE = ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'];
export const isViewable = (contentType: string) => VIEWABLE.some((t) => contentType.startsWith(t));

interface Props {
  /** Đường dẫn tải của tệp, chưa kèm `?inline=1`. */
  url: string;
  fileName: string;
  contentType: string;
  sizeBytes?: number;
  /** Chỉ hiện tên tệp và hai nút, không hiện biểu tượng kẹp giấy và cỡ tệp (dùng trong bảng). */
  compact?: boolean;
}

/** Hộp xem tệp: pdf và văn bản trong khung, ảnh hiện trực tiếp. Chỉ được dựng khi đang mở. */
function PreviewModal({ url, fileName, contentType, onClose }: { url: string; fileName: string; contentType: string; onClose: () => void }) {
  const src = `${url}?inline=1`;
  return (
    <Modal
      open
      title={fileName}
      width="min(1000px, 94vw)"
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button icon={<DownloadOutlined />} href={url} target="_blank" rel="noreferrer">
            Tải về
          </Button>
          <Button onClick={onClose}>Đóng</Button>
        </Space>
      }
    >
      {contentType.startsWith('image/') ? (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh do máy chủ trả theo phiên đăng nhập, không qua trình tối ưu ảnh của Next
        <img src={src} alt={fileName} style={{ maxWidth: '100%', maxHeight: '75vh', display: 'block', margin: '0 auto' }} />
      ) : (
        <iframe src={src} title={fileName} style={{ width: '100%', height: '75vh', border: '1px solid #f3e4e6', borderRadius: 6 }} />
      )}
    </Modal>
  );
}

/** Tên tệp kèm nút Xem (nếu xem được) và Tải về. */
export default function FileLink({ url, fileName, contentType, sizeBytes, compact }: Props) {
  const [open, setOpen] = useState(false);
  const viewable = isViewable(contentType);

  return (
    <>
      <Space size={4} wrap>
        {!compact && <PaperClipOutlined />}
        {viewable ? (
          <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => setOpen(true)} title="Xem tệp">
            {fileName}
          </Button>
        ) : (
          <a href={url} target="_blank" rel="noreferrer" title="Tải về">
            {fileName}
          </a>
        )}
        {!compact && sizeBytes !== undefined && <span style={{ color: '#888' }}>({fileSizeText(sizeBytes)})</span>}
        {viewable && (
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setOpen(true)} title="Xem tệp" aria-label={`Xem ${fileName}`} />
        )}
        <Button type="text" size="small" icon={<DownloadOutlined />} href={url} target="_blank" rel="noreferrer" title="Tải về" aria-label={`Tải về ${fileName}`} />
      </Space>
      {open && <PreviewModal url={url} fileName={fileName} contentType={contentType} onClose={() => setOpen(false)} />}
    </>
  );
}
