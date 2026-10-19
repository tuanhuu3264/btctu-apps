'use client';

import { AuditOutlined } from '@ant-design/icons';
import { Alert, Button, Drawer, Empty, Spin, Tag, Timeline, Typography } from 'antd';
import { useState } from 'react';
import type { AuditEntry } from '@/lib/api';
import { apiGet } from '@/lib/client';
import { AUDIT_MODULE_LABELS, AUDIT_TYPE_LABELS, dateTimeText } from '@/lib/labels';

const PAGE_SIZE = 30;

/** Hiển thị giá trị trong "trước/sau": chuỗi giữ nguyên, còn lại in JSON gọn. */
function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(trống)';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Các dòng "trường: trước → sau" từ `details.before` và `details.after` nếu có. */
function diffLines(details: AuditEntry['details']): { field: string; before: string; after: string }[] {
  const before = details?.before;
  const after = details?.after;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].map((field) => ({ field, before: valueText(b[field]), after: valueText(a[field]) }));
}

interface Props {
  /** Loại đối tượng trong nhật ký, ví dụ `unit`, `position`, `person`. */
  targetType: string;
  targetId: string;
  /** Tiêu đề hộp lịch sử, thường là tên đối tượng. */
  title: string;
  /** Chỉ người có quyền `audit:read` mới thấy nút. */
  canView: boolean;
  size?: 'small' | 'middle';
}

/** Nút mở khung "Nhật ký thay đổi" của một đối tượng: ai làm gì, lúc nào, giá trị trước và sau (PLAN-A A5.5). */
export default function ChangeHistoryButton({ targetType, targetId, title, canView, size = 'small' }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canView) return null;

  const base = `/audit-logs/entity/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`;

  async function load(beforeId?: string) {
    setLoading(true);
    setError(null);
    try {
      const next = await apiGet<AuditEntry[]>(`${base}?limit=${PAGE_SIZE}${beforeId ? `&beforeId=${beforeId}` : ''}`);
      setRows((current) => (beforeId ? [...current, ...next] : next));
      setMore(next.length >= PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  }

  function show() {
    setOpen(true);
    void load();
  }

  return (
    <>
      <Button size={size} icon={<AuditOutlined />} onClick={show} aria-label={`Nhật ký thay đổi: ${title}`}>
        Nhật ký
      </Button>
      <Drawer title={`Nhật ký thay đổi: ${title}`} open={open} onClose={() => setOpen(false)} size={520}>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        {loading && rows.length === 0 ? (
          <Spin />
        ) : rows.length === 0 ? (
          <Empty description="Chưa có thay đổi nào được ghi" />
        ) : (
          <Timeline
            items={rows.map((r) => ({
              color: r.outcome === 'SUCCESS' ? 'green' : 'red',
              children: (
                <>
                  <div>
                    <Tag>{AUDIT_MODULE_LABELS[r.module] ?? r.module}</Tag>
                    <Tag color="blue">{AUDIT_TYPE_LABELS[r.type] ?? r.type}</Tag>
                    <Typography.Text code>{r.action}</Typography.Text>
                  </div>
                  <div style={{ color: '#888' }}>
                    {dateTimeText(r.occurredAt)} · {r.actorUsername ?? 'hệ thống'}
                  </div>
                  {typeof r.details?.reason === 'string' && r.details.reason !== '' && <div>Lý do: {r.details.reason}</div>}
                  {diffLines(r.details).map((d) => (
                    <div key={d.field}>
                      <strong>{d.field}</strong>: <span style={{ textDecoration: 'line-through', color: '#999' }}>{d.before}</span> → {d.after}
                    </div>
                  ))}
                </>
              ),
            }))}
          />
        )}
        {more && (
          <div style={{ textAlign: 'center' }}>
            <Button loading={loading} onClick={() => load(rows[rows.length - 1].id)}>
              Tải thêm
            </Button>
          </div>
        )}
      </Drawer>
    </>
  );
}
