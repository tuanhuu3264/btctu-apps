'use client';

import { BarChartOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Progress, Radio, Select, Space, Table, Tag, Typography } from 'antd';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import ExportButtons from '@/components/export-buttons';
import type { ProjectKind, ProjectRow, ProjectStatus } from '@/lib/api';
import { dmyText, PROJECT_KIND_LABELS, PROJECT_STATUS_COLORS, PROJECT_STATUS_LABELS } from '@/lib/labels';
import { useRemote } from '@/lib/use-remote';
import ProjectFormModal from './project-form-modal';
import ProjectStatisticsModal from './project-statistics-modal';

type ScopeKey = 'mine' | 'team' | 'all';

interface Props {
  people: { value: string; label: string }[];
  canCreate: boolean;
  canReadAll: boolean;
}

/** Danh sách đề án, dự án (ADR-050): lọc theo phạm vi, trạng thái, loại, từ khóa; xuất tệp và thống kê theo đúng bộ lọc. */
export default function ProjectsView({ people, canCreate, canReadAll }: Props) {
  const router = useRouter();
  const [scope, setScope] = useState<ScopeKey>('mine');
  const [status, setStatus] = useState<ProjectStatus | undefined>(undefined);
  const [kind, setKind] = useState<ProjectKind | undefined>(undefined);
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Gõ từ khóa xong 350 ms mới tìm.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = new URLSearchParams({ scope });
  if (status) params.set('status', status);
  if (kind) params.set('kind', kind);
  if (q) params.set('q', q);
  const query = params.toString();
  const { data, error, loading } = useRemote<ProjectRow[]>(`/projects?${query}`, version);
  const filtered = status !== undefined || kind !== undefined || q !== '';

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          options={[
            { value: 'mine', label: 'Của tôi' },
            { value: 'team', label: 'Cấp dưới' },
            ...(canReadAll ? [{ value: 'all', label: 'Tất cả' }] : []),
          ]}
        />
        <Input.Search allowClear placeholder="Tìm theo mã, tên (không cần dấu)" style={{ width: 280, maxWidth: '100%' }} value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <Select
          allowClear
          placeholder="Trạng thái"
          style={{ width: 170 }}
          value={status}
          onChange={setStatus}
          options={(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))}
        />
        <Select
          allowClear
          placeholder="Loại"
          style={{ width: 130 }}
          value={kind}
          onChange={setKind}
          options={(Object.keys(PROJECT_KIND_LABELS) as ProjectKind[]).map((k) => ({ value: k, label: PROJECT_KIND_LABELS[k] }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => setVersion((n) => n + 1)} loading={loading}>
          Tải lại
        </Button>
        {filtered && (
          <Button
            onClick={() => {
              setStatus(undefined);
              setKind(undefined);
              setQInput('');
              setQ('');
            }}
          >
            Bỏ lọc
          </Button>
        )}
      </Space>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space wrap>
          <Button icon={<BarChartOutlined />} onClick={() => setShowStats(true)}>
            Thống kê
          </Button>
          <ExportButtons path={`/projects/export?${query}`} />
        </Space>
        {canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Lập đề án/dự án
          </Button>
        )}
      </Space>

      {error && <Alert type="error" showIcon message={error} />}
      <Table<ProjectRow>
        rowKey={(r) => r.project.id}
        size="middle"
        loading={loading}
        dataSource={data ?? []}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: filtered ? 'Không có đề án, dự án nào khớp bộ lọc.' : 'Chưa có đề án, dự án nào.' }}
        pagination={{ pageSize: 20, hideOnSinglePage: true, showTotal: (t) => `${t} đề án, dự án` }}
        columns={[
          { title: 'Mã', render: (_: unknown, r) => <Typography.Text code>{r.project.code}</Typography.Text> },
          { title: 'Loại', render: (_: unknown, r) => <Tag>{PROJECT_KIND_LABELS[r.project.kind]}</Tag> },
          {
            title: 'Tên',
            render: (_: unknown, r) => (
              <Link href={`/projects/${r.project.id}`} style={{ display: 'inline-block', minWidth: 220, maxWidth: 420, whiteSpace: 'normal' }}>
                {r.project.title}
              </Link>
            ),
          },
          { title: 'Chủ trì', dataIndex: 'ownerName' },
          { title: 'Đơn vị', dataIndex: 'unitName' },
          { title: 'Thời gian', render: (_: unknown, r) => `${dmyText(r.project.startDate)} – ${dmyText(r.project.endDate)}` },
          { title: 'Trạng thái', render: (_: unknown, r) => <Tag color={PROJECT_STATUS_COLORS[r.project.status]}>{PROJECT_STATUS_LABELS[r.project.status]}</Tag> },
          {
            title: 'Tiến độ',
            render: (_: unknown, r) =>
              r.progress.ratio === null ? (
                <Typography.Text type="secondary">Chưa có mốc</Typography.Text>
              ) : (
                <Progress percent={Math.round(r.progress.ratio * 100)} size="small" style={{ minWidth: 110 }} />
              ),
          },
          {
            title: 'Mốc quá hạn',
            align: 'right',
            render: (_: unknown, r) => (r.progress.overdue > 0 ? <Typography.Text type="danger" strong>{r.progress.overdue}</Typography.Text> : 0),
          },
          { title: 'Việc gắn', align: 'right', render: (_: unknown, r) => r.workCount },
        ]}
      />
      {showStats && <ProjectStatisticsModal query={query} onClose={() => setShowStats(false)} />}
      {creating && <ProjectFormModal people={people} onClose={() => setCreating(false)} onCreated={(id) => router.push(`/projects/${id}`)} />}
    </Space>
  );
}
