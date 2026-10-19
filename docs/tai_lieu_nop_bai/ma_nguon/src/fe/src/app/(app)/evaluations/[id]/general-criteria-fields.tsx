'use client';

import { Alert, Card, Form, Input, Radio, Space, Tag, Typography } from 'antd';
import type { FormInstance } from 'antd';
import type { EvaluationDetail, GeneralCriteriaSet, GeneralMark } from '@/lib/api';

type Values = Record<string, unknown>;
type Criteria = NonNullable<EvaluationDetail['generalCriteria']>;

/** Tên trường của một mục: mã có dấu chấm nên đổi sang gạch dưới. */
const okField = (code: string) => `gm-ok-${code.replace(/\./g, '_')}`;
const noteField = (code: string) => `gm-note-${code.replace(/\./g, '_')}`;

type Forced = EvaluationDetail['forcedItems'];

/**
 * Giá trị ban đầu của form: theo kết quả đã có (tự chấm), không thì mọi mục Đảm bảo. Mục bị buộc do kỷ luật, kết luận trong kỳ
 * (ADR-055) luôn là Không đảm bảo, căn cứ gợi ý sẵn theo văn bản.
 */
export function generalInitial(set: GeneralCriteriaSet, from: GeneralMark[] | null | undefined, forced: Forced = []): Values {
  const by = new Map((from ?? []).map((m) => [m.code, m]));
  const must = new Map(forced.map((f) => [f.code, f.reasons.join('; ')]));
  return Object.fromEntries(
    set.items.flatMap((i) => [
      [okField(i.code), must.has(i.code) ? false : (by.get(i.code)?.ok ?? true)],
      [noteField(i.code), by.get(i.code)?.note || must.get(i.code) || ''],
    ]),
  );
}

/** Kết quả chấm từng mục để gửi lên. */
export function generalMarks(set: GeneralCriteriaSet, v: Values): { code: string; ok: boolean; note?: string }[] {
  return set.items.map((i) => {
    const note = String(v[noteField(i.code)] ?? '').trim();
    return { code: i.code, ok: v[okField(i.code)] !== false, ...(note ? { note } : {}) };
  });
}

function totalOf(set: GeneralCriteriaSet, v: Values | undefined): number {
  return Math.round(set.items.reduce((s, i) => s + (v?.[okField(i.code)] === false ? 0 : i.max), 0) * 100) / 100;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');

/**
 * Chấm tiêu chí chung theo mục con (ADR-054): mỗi mục Đảm bảo (đủ điểm) hoặc Không đảm bảo (0 điểm, phải ghi căn cứ). Người thẩm
 * định thấy kết quả tự chấm từng mục; chấm khác thì cũng phải ghi căn cứ.
 */
export default function GeneralCriteriaFields({
  form,
  criteria,
  selfMarks,
  previous,
  forced = [],
}: {
  form: FormInstance<Values>;
  criteria: Criteria;
  /** Kết quả tự chấm, chỉ truyền khi thẩm định. */
  selfMarks?: GeneralMark[] | null;
  previous: EvaluationDetail['previous'];
  /** Mục bắt buộc Không đảm bảo do kỷ luật, kết luận trong kỳ. */
  forced?: Forced;
}) {
  const must = new Map(forced.map((f) => [f.code, f.reasons]));
  const values = Form.useWatch([], form) as Values | undefined;
  const self = new Map((selfMarks ?? []).map((m) => [m.code, m]));
  const reviewing = selfMarks !== undefined;

  return (
    <Card
      size="small"
      type="inner"
      title={`Tiêu chí chung (30 điểm): ${criteria.groupLabel}`}
      extra={<Typography.Text strong>Tổng: {fmt(totalOf(criteria, values))}/30</Typography.Text>}
      style={{ marginBottom: 16 }}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Mỗi mục: Đảm bảo thì được điểm tối đa của mục, Không đảm bảo thì 0 điểm và phải ghi căn cứ (hạn chế, vi phạm cụ thể; văn bản nhắc nhở nếu có).
        {reviewing ? ' Chấm khác kết quả tự chấm cũng phải ghi căn cứ.' : ''} Không đánh Không đảm bảo chỉ vì sai sót sản phẩm đã bị trừ ở chất lượng, tiến độ.
        {criteria.note ? ` Căn cứ: ${criteria.note}` : ''}
      </Typography.Paragraph>
      {previous && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          title={`Hạn chế đã nêu ở kỳ ${previous.periodLabel} (đối chiếu các mục khắc phục hạn chế, khuyết điểm)`}
          description={
            <Space orientation="vertical" size={2}>
              {previous.limitations.map((l) => (
                <span key={l.code}>
                  <Typography.Text strong>{l.code}</Typography.Text> {l.name}
                  {l.note ? `: ${l.note}` : ''}
                </span>
              ))}
              {previous.reviewComment && <span>Nhận xét: {previous.reviewComment}</span>}
            </Space>
          }
        />
      )}
      {criteria.sections.map((s) => {
        const items = criteria.items.filter((i) => i.section === s.code);
        const max = items.reduce((sum, i) => sum + i.max, 0);
        return (
          <div key={s.code} style={{ marginBottom: 12 }}>
            <Typography.Text strong>
              {s.code}. {s.name} ({fmt(max)} điểm)
            </Typography.Text>
            {items.map((i) => {
              const ok = values?.[okField(i.code)] !== false;
              const mine = self.get(i.code);
              const differs = reviewing && mine !== undefined && mine.ok !== ok;
              return (
                <div key={i.code} data-item={i.code} style={{ padding: '8px 0 0 12px', borderTop: '1px solid var(--ant-color-split, #f0f0f0)', marginTop: 8 }}>
                  <Space align="start" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                    <Typography.Text style={{ maxWidth: 640, display: 'inline-block' }}>
                      <Typography.Text strong>{i.code}</Typography.Text> {i.name} <Typography.Text type="secondary">({fmt(i.max)} điểm)</Typography.Text>
                    </Typography.Text>
                    <Space size="small">
                      {mine && (
                        <Tag color={mine.ok ? 'green' : 'red'} title={mine.note ?? undefined}>
                          Tự chấm: {mine.ok ? 'Đảm bảo' : 'Không đảm bảo'}
                        </Tag>
                      )}
                      {must.has(i.code) && (
                        <Tag color="volcano" title={must.get(i.code)!.join('; ')}>
                          Bắt buộc Không đảm bảo
                        </Tag>
                      )}
                      <Form.Item name={okField(i.code)} noStyle>
                        <Radio.Group
                          disabled={must.has(i.code)}
                          size="small"
                          optionType="button"
                          buttonStyle="solid"
                          options={[
                            { value: true, label: 'Đảm bảo' },
                            { value: false, label: 'Không đảm bảo' },
                          ]}
                        />
                      </Form.Item>
                    </Space>
                  </Space>
                  {(!ok || differs) && (
                    <Form.Item
                      name={noteField(i.code)}
                      rules={[{ required: true, whitespace: true, message: differs && ok ? 'Chấm khác kết quả tự chấm: ghi căn cứ' : 'Không đảm bảo: ghi căn cứ' }]}
                      style={{ margin: '8px 0 0' }}
                    >
                      <Input.TextArea rows={1} maxLength={1000} placeholder="Căn cứ: hạn chế, vi phạm cụ thể, thời điểm, văn bản nhắc nhở (nếu có)" />
                    </Form.Item>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </Card>
  );
}
