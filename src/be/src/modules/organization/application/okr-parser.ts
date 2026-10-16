/** Một kết quả then chốt của vị trí: mã (KR1, KR4–KR7...) và nội dung. */
export interface KeyResult {
  code: string;
  text: string;
}

/** Cột "KPI – OKR then chốt" của tệp sơ đồ phân công, tách thành Mục tiêu và các Kết quả then chốt. */
export interface ParsedOkr {
  /** Nguyên văn trong tệp. */
  raw: string;
  objective: string | null;
  keyResults: KeyResult[];
}

const KR_MARKER = /(KR\d+(?:\s*[–-]\s*KR\d+)?)\s*:\s*/g;
const SENTENCE_BREAK = /(?<=\.)\s+(?=[\p{Lu}\d≥])/u;

const tidy = (s: string): string => s.replace(/\s+/g, ' ').replace(/^[\s.;:]+|[\s.;:]+$/g, '');
const numbered = (parts: string[]): KeyResult[] =>
  parts
    .map(tidy)
    .filter((p) => p !== '')
    .map((text, i) => ({ code: `KR${i + 1}`, text }));

/**
 * Tách cột OKR. Tệp thật có nhiều cách viết nên dùng quy tắc theo thứ tự, mỗi quy tắc chỉ nhận khi đủ dấu hiệu:
 *
 * 1. Có mã `KRn:`: phần trước mã đầu tiên là Mục tiêu (bỏ tiền tố `O:`), mỗi mã là một kết quả then chốt.
 * 2. Có `OKR:` (sau phần `KPI:`): các ý cách nhau dấu chấm phẩy là kết quả then chốt, đánh mã KR1, KR2...
 * 3. Bắt đầu bằng "Chỉ đạo": mô tả hướng chỉ đạo của cấp lãnh đạo, coi là Mục tiêu, không có kết quả then chốt đo được.
 * 4. Còn lại: mỗi câu là một kết quả then chốt, đánh mã KR1, KR2...
 *
 * Kết quả chỉ dùng để gợi ý lựa chọn; nguyên văn luôn được giữ trong `raw`.
 */
export function parseOkr(raw: string | null | undefined): ParsedOkr | null {
  const text = raw?.replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const markers = [...text.matchAll(KR_MARKER)];
  if (markers.length > 0) {
    const head = tidy(text.slice(0, markers[0].index).replace(/^O\s*:\s*/, ''));
    const keyResults = markers.map((m, i) => ({
      code: m[1].replace(/\s+/g, ''),
      text: tidy(text.slice(m.index + m[0].length, markers[i + 1]?.index ?? text.length)),
    }));
    return { raw: text, objective: head || null, keyResults: keyResults.filter((k) => k.text !== '') };
  }

  const okr = /\bOKR\s*:\s*/.exec(text);
  if (okr) return { raw: text, objective: null, keyResults: numbered(text.slice(okr.index + okr[0].length).split(';')) };

  if (/^Chỉ đạo/i.test(text)) return { raw: text, objective: tidy(text), keyResults: [] };

  return { raw: text, objective: null, keyResults: numbered(text.split(SENTENCE_BREAK)) };
}

/** Nhãn đầy đủ của một kết quả then chốt, dùng khi lưu và hiển thị. */
export const keyResultLabel = (k: KeyResult): string => `${k.code}: ${k.text}`;
