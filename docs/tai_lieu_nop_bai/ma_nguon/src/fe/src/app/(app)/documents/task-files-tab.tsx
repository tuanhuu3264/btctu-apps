'use client';

import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, DatePicker, Input, Select, Space, Table } from 'antd';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import FileLink from '@/components/file-link';
import type { TaskFilePage } from '@/lib/api';
import { API_URL } from '@/lib/client';
import { dateTimeText, fileSizeText } from '@/lib/labels';
import { useRemote } from '@/lib/use-remote';

type DayValue = { format: (pattern: string) => string } | null;

interface Props {
  names: Record<string, string>;
}

/** Tệp đính kèm của mọi việc mà người dùng là thành viên (ADR-025 mục 1). Chỉ đọc; tải về qua đường tải của việc. */
export default function TaskFilesTab({ names }: Props) {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [uploader, setUploader] = useState<string | undefined>(undefined);
  const [range, setRange] = useState<[DayValue, DayValue] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [version, setVersion] = useState(0);
  const uploaderOptions = useMemo(() => Object.entries(names).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi')), [names]);

  // Gõ từ khóa xong 350 ms mới tìm, và về trang 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) params.set('q', q);
  if (uploader) params.set('uploaderPersonId', uploader);
  if (range?.[0]) params.set('from', range[0].format('YYYY-MM-DD'));
  if (range?.[1]) params.set('to', range[1].format('YYYY-MM-DD'));
  const { data, error, loading } = useRemote<TaskFilePage>(`/tasking/files?${params}`, version);
  const filtered = q !== '' || uploader !== undefined || range !== null;

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Input.Search allowClear placeholder="Tìm theo tên tệp, tên việc (không cần dấu)" style={{ width: 340 }} value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Người tải lên"
          style={{ width: 220 }}
          value={uploader}
          options={uploaderOptions}
          onChange={(v) => {
            setUploader(v);
            setPage(1);
          }}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          placeholder={['Tải từ ngày', 'đến']}
          value={range as never}
          onChange={(v) => {
            setRange(v as [DayValue, DayValue] | null);
            setPage(1);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={() => setVersion((n) => n + 1)} loading={loading}>
          Tải lại
        </Button>
        {filtered && (
          <Button
            onClick={() => {
              setQInput('');
              setQ('');
              setUploader(undefined);
              setRange(null);
              setPage(1);
            }}
          >
            Bỏ lọc
          </Button>
        )}
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.items ?? []}
        locale={{ emptyText: filtered ? 'Không có tệp nào khớp bộ lọc.' : 'Chưa có tệp nào trong các việc của bạn.' }}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `${t} tệp`,
          onChange: (p, s) => {
            setPage(s !== pageSize ? 1 : p);
            setPageSize(s);
          },
        }}
        columns={[
          {
            title: 'Tên tệp',
            dataIndex: 'fileName',
            render: (name: string, f) => <FileLink compact url={`${API_URL}/tasking/assignments/${f.assignmentId}/attachments/${f.id}`} fileName={name} contentType={f.contentType} />,
          },
          { title: 'Cỡ', dataIndex: 'sizeBytes', align: 'right', render: (n: number) => fileSizeText(n) },
          {
            title: 'Việc chứa tệp',
            render: (_: unknown, f) => (
              <Link href={`/tasks?open=${f.assignmentId}`} title="Mở việc">
                {f.taskTitle || 'Việc được giao'} · {f.catalogItemCode}
              </Link>
            ),
          },
          { title: 'Người nhận việc', dataIndex: 'assigneePersonId', render: (id: string) => names[id] ?? '–' },
          { title: 'Người tải lên', dataIndex: 'uploadedByPersonId', render: (id: string | null) => (id ? (names[id] ?? 'Không rõ') : '–') },
          { title: 'Tải lúc', dataIndex: 'uploadedAt', render: (iso: string) => dateTimeText(iso) },
        ]}
      />
    </Space>
  );
}
