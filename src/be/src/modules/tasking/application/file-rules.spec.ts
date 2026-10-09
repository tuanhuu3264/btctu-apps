import { BadRequestException } from '@nestjs/common';
import { fileResponseHeaders, isViewable } from './file-rules.js';

const pdf = { fileName: 'Báo cáo quý I.pdf', contentType: 'application/pdf' };
const docx = { fileName: 'Quy chế.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

describe('fileResponseHeaders (ADR-026)', () => {
  it('mặc định là tệp đính kèm, có nosniff, không cho trình duyệt giữ bản sao', () => {
    const h = fileResponseHeaders(pdf, 10, false, 'http://localhost:3000');
    expect(h['Content-Disposition']).toBe(`attachment; filename="B_o c_o qu_ I.pdf"; filename*=UTF-8''${encodeURIComponent('Báo cáo quý I.pdf')}`);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Cache-Control']).toBe('private, no-store');
    expect(h['Content-Length']).toBe('10');
    expect(h).not.toHaveProperty('Content-Security-Policy');
  });

  it('xem trực tiếp: inline và chỉ cho nhúng trong giao diện của hệ thống', () => {
    const h = fileResponseHeaders(pdf, 10, true, 'http://localhost:3000');
    expect(h['Content-Disposition']).toMatch(/^inline;/);
    expect(h['Content-Security-Policy']).toBe('frame-ancestors http://localhost:3000');
  });

  it('chỉ pdf, png, jpg, văn bản thuần xem được; tệp Office phải tải về', () => {
    for (const t of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain; charset=utf-8']) expect(isViewable(t)).toBe(true);
    for (const t of [docx.contentType, 'text/csv; charset=utf-8', 'text/html', 'image/svg+xml']) expect(isViewable(t)).toBe(false);
    expect(() => fileResponseHeaders(docx, 10, true, 'http://localhost:3000')).toThrow(BadRequestException);
    expect(fileResponseHeaders(docx, 10, false, 'http://localhost:3000')['Content-Disposition']).toMatch(/^attachment;/);
  });
});
