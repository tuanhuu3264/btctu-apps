import JSZip from 'jszip';
import { buildDraft } from '../application/draft-templates.js';
import { approved, report } from '../application/testing/fixtures.js';
import { renderDraftDocx } from './draft-docx.js';

async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

describe('renderDraftDocx', () => {
  it('tạo tệp Word hợp lệ, giữ tiếng Việt, lời cảnh báo dự thảo và các dòng của văn bản', async () => {
    const draft = buildDraft('DECISION', report([approved('Nguyễn Văn A', 92, 'XUAT_SAC')]));
    const buffer = await renderDraftDocx(draft);
    expect(buffer.subarray(0, 2).toString()).toBe('PK'); // .docx là tệp zip
    const xml = await documentXml(buffer);
    expect(xml).toContain('DỰ THẢO, chỉ để tham khảo');
    expect(xml).toContain('QUYẾT ĐỊNH');
    expect(xml).toContain('Nguyễn Văn A');
    expect(xml).toContain('Điều 1.');
    expect(xml).toContain('BAN TỔ CHỨC TỈNH ỦY ĐẮK LẮK'); // dòng hai cột đầu văn bản
  });

  it('dự thảo báo cáo có đủ các mục và không để lọt dấu cách canh cột làm nội dung', async () => {
    const xml = await documentXml(await renderDraftDocx(buildDraft('REPORT', report([approved('Trần Thị B', 80, 'HOAN_THANH_TOT')]))));
    expect(xml).toContain('I. TÌNH HÌNH CHUNG');
    expect(xml).toContain('III. KẾT QUẢ THEO ĐƠN VỊ');
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]* {5,}[^<]*<\/w:t>/);
  });
});
