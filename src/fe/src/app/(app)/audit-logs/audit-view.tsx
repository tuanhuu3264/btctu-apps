'use client';

import { SafetyCertificateOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Descriptions, Form, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AuditEntry, AuditVerification } from '@/lib/api';
import ExportButtons from '@/components/export-buttons';
import { apiGet } from '@/lib/client';
import { AUDIT_MODULE_LABELS, AUDIT_TYPE_LABELS, dateTimeText } from '@/lib/labels';

const OUTCOME_LABELS: Record<AuditEntry['outcome'], { text: string; color: string }> = {
  SUCCESS: { text: 'Thành công', color: 'green' },
  DENIED: { text: 'Bị từ chối', color: 'orange' },
  FAILURE: { text: 'Thất bại', color: 'red' },
};

interface Filters {
  action?: string;
  outcome?: string;
  username?: string;
  module?: string;
  type?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

interface Props {
  initialRows: AuditEntry[];
  actions: string[];
  facets: { modules: string[]; types: string[] };
  filters: Filters;
  /** Chuỗi truy vấn của bộ lọc (không có `limit`, `beforeId`), dùng để tải thêm. */
  baseQuery: string;
  pageSize: number;
}

export default function AuditView({ initialRows, actions, facets, filters, baseQuery, pageSize }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [more, setMore] = useState(initialRows.length >= pageSize);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<AuditVerification | null>(null);
  const [verifying, setVerifying] = useState(false);

  function apply(values: Filters) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) if (typeof v === 'string' && v.trim() !== '') q.set(k, v.trim());
    router.push(`/audit-logs${q.size > 0 ? `?${q}` : ''}`);
  }

  async function loadMore() {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams(baseQuery);
      q.set('limit', String(pageSize));
      q.set('beforeId', rows[rows.length - 1].id);
      const next = await apiGet<AuditEntry[]>(`/audit-logs?${q}`);
      setRows((current) => [...current, ...next]);
      setMore(next.length >= pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    setVerifying(true);
    setError(null);
    try {
      setVerification(await apiGet<AuditVerification>('/audit-logs/verify'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Nhật ký chỉ ghi thêm, không sửa hay xóa được; mỗi dòng có mã băm nối với dòng trước. Việc xem nhật ký cũng được ghi lại."
      />

      <Form layout="inline" initialValues={filters} onFinish={apply} style={{ rowGap: 12 }}>
        <Form.Item name="action" label="Hành động">
          <Select allowClear showSearch style={{ width: 240 }} placeholder="Tất cả" options={actions.map((a) => ({ value: a, label: a }))} />
        </Form.Item>
        <Form.Item name="module" label="Mô-đun">
          <Select
            allowClear
            style={{ width: 150 }}
            placeholder="Tất cả"
            options={facets.modules.map((m) => ({ value: m, label: AUDIT_MODULE_LABELS[m] ?? m }))}
          />
        </Form.Item>
        <Form.Item name="type" label="Loại">
          <Select
            allowClear
            style={{ width: 160 }}
            placeholder="Tất cả"
            options={facets.types.map((t) => ({ value: t, label: AUDIT_TYPE_LABELS[t] ?? t }))}
          />
        </Form.Item>
        <Form.Item name="targetType" label="Loại đối tượng">
          <Input allowClear style={{ width: 150 }} maxLength={32} placeholder="unit, position..." />
        </Form.Item>
        <Form.Item name="targetId" label="Mã đối tượng">
          <Input allowClear style={{ width: 220 }} maxLength={64} />
        </Form.Item>
        <Form.Item name="outcome" label="Kết quả">
          <Select
            allowClear
            style={{ width: 150 }}
            placeholder="Tất cả"
            options={Object.entries(OUTCOME_LABELS).map(([value, { text }]) => ({ value, label: text }))}
          />
        </Form.Item>
        <Form.Item name="username" label="Tên đăng nhập">
          <Input allowClear style={{ width: 170 }} maxLength={64} />
        </Form.Item>
        <Form.Item name="from" label="Từ ngày" rules={[{ pattern: /^\d{4}-\d{2}-\d{2}$/, message: 'Dạng 2026-10-01' }]}>
          <Input placeholder="2026-10-01" style={{ width: 130 }} maxLength={10} />
        </Form.Item>
        <Form.Item name="to" label="Đến ngày" rules={[{ pattern: /^\d{4}-\d{2}-\d{2}$/, message: 'Dạng 2026-10-31' }]}>
          <Input placeholder="2026-10-31" style={{ width: 130 }} maxLength={10} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
              Lọc
            </Button>
            <Button onClick={() => apply({})}>Bỏ lọc</Button>
          </Space>
        </Form.Item>
      </Form>

      <Space wrap>
        <Button icon={<SafetyCertificateOutlined />} loading={verifying} onClick={verify}>
          Kiểm tra toàn vẹn chuỗi băm
        </Button>
        <Typography.Text type="secondary">Duyệt toàn bộ nhật ký, có thể mất vài giây khi nhật ký lớn.</Typography.Text>
        <ExportButtons path={`/audit-logs/export${baseQuery ? `?${baseQuery}` : ''}`} />
      </Space>

      {verification && (
        <Alert
          type={verification.valid ? 'success' : 'error'}
          showIcon
          message={verification.valid ? `Chuỗi băm nguyên vẹn: đã kiểm ${verification.checked} bản ghi` : `Phát hiện bất thường tại bản ghi ${verification.firstInvalidId}: ${verification.reason}`}
          description={
            <>
              Bản ghi cuối: {verification.lastId ?? '–'}. Mã băm cuối: <Typography.Text code copyable>{verification.lastHash}</Typography.Text>
              <br />
              Chuỗi băm không phát hiện được việc cắt bớt các bản ghi cuối. Hãy ghi lại bản ghi cuối và mã băm cuối vào biên bản định kỳ để đối chiếu (GAP G-14).
            </>
          }
        />
      )}
      {error && <Alert type="error" showIcon message={error} />}

      <Table<AuditEntry>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: 'Không có bản ghi nào khớp bộ lọc' }}
        scroll={{ x: 1100 }}
        columns={[
          { title: 'Thời gian', dataIndex: 'occurredAt', width: 160, render: (t: string) => dateTimeText(t) },
          { title: 'Người thực hiện', dataIndex: 'actorUsername', width: 150, render: (u: string | null) => u ?? '–' },
          { title: 'Mô-đun', dataIndex: 'module', width: 110, render: (m: string) => AUDIT_MODULE_LABELS[m] ?? m },
          { title: 'Loại', dataIndex: 'type', width: 130, render: (t: string) => <Tag color="blue">{AUDIT_TYPE_LABELS[t] ?? t}</Tag> },
          { title: 'Hành động', dataIndex: 'action', render: (a: string) => <Typography.Text code>{a}</Typography.Text> },
          {
            title: 'Kết quả',
            dataIndex: 'outcome',
            width: 110,
            render: (o: AuditEntry['outcome']) => <Tag color={OUTCOME_LABELS[o].color}>{OUTCOME_LABELS[o].text}</Tag>,
          },
          {
            title: 'Đối tượng',
            width: 200,
            render: (_: unknown, r) => (r.targetType ? `${r.targetType}${r.targetId ? `: ${r.targetId.slice(0, 8)}` : ''}` : '–'),
          },
          { title: 'IP', dataIndex: 'ip', width: 130, render: (ip: string | null) => ip ?? '–' },
        ]}
        expandable={{
          expandedRowRender: (r) => (
            <Descriptions
              size="small"
              column={1}
              items={[
                { key: 'id', label: 'Số thứ tự', children: r.id },
                { key: 'req', label: 'Mã yêu cầu', children: r.requestId ?? '–' },
                { key: 'ver', label: 'Phiên bản mã băm', children: r.hashVersion === 1 ? '1 (trước khi có mô-đun/loại; mô-đun và loại được suy từ hành động)' : r.hashVersion },
                { key: 'target', label: 'Đối tượng đầy đủ', children: r.targetType ? `${r.targetType} ${r.targetId ?? ''}` : '–' },
                {
                  key: 'details',
                  label: 'Chi tiết',
                  children: r.details ? <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.details, null, 2)}</pre> : '–',
                },
                { key: 'prev', label: 'Mã băm dòng trước', children: <Typography.Text code>{r.prevHash}</Typography.Text> },
                { key: 'hash', label: 'Mã băm dòng này', children: <Typography.Text code>{r.hash}</Typography.Text> },
              ]}
            />
          ),
        }}
      />

      <div style={{ textAlign: 'center' }}>
        {more ? (
          <Button loading={loading} onClick={loadMore}>
            Tải thêm
          </Button>
        ) : (
          rows.length > 0 && <Typography.Text type="secondary">Đã hiện hết {rows.length} bản ghi khớp bộ lọc</Typography.Text>
        )}
      </div>
    </Space>
  );
}
