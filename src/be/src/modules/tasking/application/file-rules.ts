import { BadRequestException } from '@nestjs/common';
import { ALLOWED_FILE_TYPES, MAX_FILE_BYTES } from './tasking.model.js';

export interface UploadedFile {
  originalName: string;
  size: number;
  buffer: Buffer;
}

/** Dấu hiệu đầu tệp theo đuôi, để chặn tệp đổi đuôi (ví dụ chương trình đổi thành .pdf). Đuôi không có trong bảng thì bỏ qua. */
const MAGIC: Readonly<Record<string, readonly (readonly number[])[]>> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  docx: [[0x50, 0x4b, 0x03, 0x04]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],
  pptx: [[0x50, 0x4b, 0x03, 0x04]],
  doc: [[0xd0, 0xcf, 0x11, 0xe0]],
  xls: [[0xd0, 0xcf, 0x11, 0xe0]],
  ppt: [[0xd0, 0xcf, 0x11, 0xe0]],
};

/** Tên tệp an toàn: bỏ đường dẫn và ký tự điều khiển, giữ tiếng Việt, tối đa 200 ký tự (giữ đuôi). */
export function safeFileName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  // Cố ý khớp ký tự điều khiển để loại khỏi tên tệp.
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'tep';
  if (cleaned.length <= 200) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  return dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(0, 200 - (cleaned.length - dot)) + cleaned.slice(dot) : cleaned.slice(0, 200);
}

/** Kiểm tra tệp tải lên (ADR-024 mục 6, dùng chung với ADR-025): kích thước, đuôi cho phép, dấu hiệu đầu tệp. Trả tên an toàn và kiểu nội dung. */
export function validateUpload(file: UploadedFile): { fileName: string; contentType: string } {
  if (file.size < 1 || file.buffer.length < 1) throw new BadRequestException('Tệp rỗng');
  if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) throw new BadRequestException(`Tệp tối đa ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const fileName = safeFileName(file.originalName);
  const ext = (fileName.includes('.') ? fileName.split('.').pop()! : '').toLowerCase();
  const contentType = ALLOWED_FILE_TYPES[ext];
  if (!contentType) throw new BadRequestException(`Chỉ nhận các định dạng: ${Object.keys(ALLOWED_FILE_TYPES).join(', ')}`);
  const signatures = MAGIC[ext];
  if (signatures && !signatures.some((sig) => sig.every((byte, i) => file.buffer[i] === byte))) {
    throw new BadRequestException('Nội dung tệp không khớp với đuôi tệp');
  }
  return { fileName, contentType };
}

/** Kiểu nội dung trình duyệt xem được ngay mà không chạy mã: pdf, ảnh png/jpg, văn bản thuần. Tệp Office chỉ tải về. */
const VIEWABLE_TYPES: ReadonlySet<string> = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain; charset=utf-8']);

export const isViewable = (contentType: string): boolean => VIEWABLE_TYPES.has(contentType);

/**
 * Tiêu đề phản hồi khi trả tệp (ADR-026): mặc định luôn là tệp tải về; `inline` chỉ cho kiểu xem được, và chỉ cho
 * nhúng trong giao diện của hệ thống (frame-ancestors). Luôn có nosniff.
 */
export function fileResponseHeaders(file: { fileName: string; contentType: string }, length: number, inline: boolean, frontendOrigin: string): Record<string, string> {
  if (inline && !isViewable(file.contentType)) throw new BadRequestException('Định dạng này không xem trực tiếp được, hãy tải về');
  const ascii = file.fileName.replace(/[^ -~]/g, '_').replace(/"/g, '_');
  const encoded = encodeURIComponent(file.fileName);
  return {
    'Content-Type': file.contentType,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    'Content-Length': String(length),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    ...(inline ? { 'Content-Security-Policy': `frame-ancestors ${frontendOrigin}` } : {}),
  };
}
