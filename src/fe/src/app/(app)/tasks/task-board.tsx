'use client';

import { BarChartOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, DatePicker, Input, Radio, Select, Space } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { AssignmentState, AssignmentView, SearchResult, SearchScope, WorkKind } from '@/lib/api';
import { API_URL, apiGet } from '@/lib/client';
import { STATE_LABELS, WORK_KIND_LABELS } from '@/lib/labels';
import AssignmentTable from './assignment-table';
import TaskStatisticsModal from './task-statistics-modal';

type DayValue = { format: (pattern: string) => string } | null;

interface Props {
  scope: SearchScope;
  /** Đổi giá trị này (ví dụ sau khi trang được làm mới) thì danh sách tải lại. */
  stamp: number;
  myPersonId: string | null;
  names: Record<string, string>;
  /** Người nhận để lọc (cho các phạm vi khác "của tôi"). */
  assigneeOptions: { value: string; label: string }[];
  canReport: boolean;
  canConfirm: boolean;
  canAssign: boolean;
  directReportIds: Set<string>;
  onOpen: (view: AssignmentView) => void;
}

const STATES: AssignmentState[] = ['PROPOSED', 'IN_PROGRESS', 'PENDING_CONFIRM', 'OVERDUE', 'DONE', 'CANCELLED'];
const SORTS = [
  { value: 'due', label: 'Hạn gần nhất trước' },
  { value: 'dueDesc', label: 'Hạn xa nhất trước' },
  { value: 'created', label: 'Mới giao trước' },
];
const EMPTY_TEXT: Record<SearchScope, string> = {
  mine: 'Bạn chưa được giao việc nào.',
  team: 'Cấp dưới chưa có việc nào.',
  all: 'Chưa có việc nào.',
  consulted: 'Chưa có việc nào mời bạn tham vấn.',
  approving: 'Không có việc nào chờ bạn duyệt.',
  assigned: 'Bạn chưa giao việc nào.',
};

/**
 * Danh sách việc của một phạm vi, có lọc (từ khóa, trạng thái, người nhận, hạn) và phân trang do máy chủ làm (ADR-024).
 */
export default function TaskBoard({ scope, stamp, myPersonId, names, assigneeOptions, canReport, canConfirm, canAssign, directReportIds, onOpen }: Props) {
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState<AssignmentState | 'ALL'>('ALL');
  const [assignee, setAssignee] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<WorkKind | undefined>(undefined);
  const [showStats, setShowStats] = useState(false);
  const [due, setDue] = useState<[DayValue, DayValue] | null>(null);
  const [sort, setSort] = useState('due');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<SearchResult | null>(null);
  /** Khóa của lần tải gần nhất đã xong; khác khóa hiện tại nghĩa là đang tải. */
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const request = useRef(0);

  // Gõ từ khóa xong 350 ms mới tìm, và về trang 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const params = new URLSearchParams({ scope, sort, page: String(page), pageSize: String(pageSize) });
  if (q) params.set('q', q);
  if (state !== 'ALL') params.set('states', state);
  if (assignee) params.set('assigneePersonId', assignee);
  if (kind) params.set('kind', kind);
  if (due?.[0]) params.set('dueFrom', due[0].format('YYYY-MM-DD'));
  if (due?.[1]) params.set('dueTo', due[1].format('YYYY-MM-DD'));
  const key = `${params}#${stamp}#${reload}`;
  const loading = loadedKey !== key;

  useEffect(() => {
    const mine = ++request.current;
    apiGet<SearchResult>(`/tasking/assignments/search?${key.split('#')[0]}`)
      .then((r) => {
        if (mine !== request.current) return; // đã có yêu cầu mới hơn
        setData(r);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e: Error) => {
        if (mine !== request.current) return;
        setError(e.message);
        setLoadedKey(key);
      });
  }, [key]);

  const filtered = q !== '' || state !== 'ALL' || assignee !== undefined || kind !== undefined || due !== null;
  // Xuất và thống kê dùng đúng bộ lọc đang chọn, không phân trang.
  const filterParams = new URLSearchParams(params);
  for (const k of ['page', 'pageSize', 'sort']) filterParams.delete(k);
  const filterQuery = filterParams.toString();
  const reset = () => {
    setQInput('');
    setQ('');
    setState('ALL');
    setAssignee(undefined);
    setKind(undefined);
    setDue(null);
    setSort('due');
    setPage(1);
  };
  const total = data ? Object.values(data.stateCounts).reduce((a, b) => a + b, 0) : 0;

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Space wrap>
        <Input.Search allowClear placeholder="Tìm theo nhiệm vụ, công việc, nội dung (không cần dấu)" style={{ width: 340 }} value={qInput} onChange={(e) => setQInput(e.target.value)} />
        {scope !== 'mine' && (
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="Người nhận"
            style={{ width: 240 }}
            value={assignee}
            options={assigneeOptions}
            onChange={(v) => {
              setAssignee(v);
              setPage(1);
            }}
          />
        )}
        <Select
          allowClear
          placeholder="Loại việc"
          style={{ width: 160 }}
          value={kind}
          options={(Object.keys(WORK_KIND_LABELS) as WorkKind[]).map((k) => ({ value: k, label: WORK_KIND_LABELS[k] }))}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
        />
        <DatePicker.RangePicker
          format="DD/MM/YYYY"
          placeholder={['Hạn từ', 'đến']}
          onChange={(v) => {
            setDue(v as [DayValue, DayValue] | null);
            setPage(1);
          }}
          value={due as never}
        />
        <Select value={sort} options={SORTS} style={{ width: 190 }} onChange={setSort} />
        <Button icon={<ReloadOutlined />} onClick={() => setReload((n) => n + 1)} loading={loading}>
          Tải lại
        </Button>
        {filtered && <Button onClick={reset}>Bỏ lọc</Button>}
        <Button icon={<BarChartOutlined />} onClick={() => setShowStats(true)}>
          Thống kê
        </Button>
        <Button icon={<DownloadOutlined />} href={`${API_URL}/tasking/assignments/export?${filterQuery}&format=xlsx`}>
          Xuất Excel
        </Button>
        <Button icon={<DownloadOutlined />} href={`${API_URL}/tasking/assignments/export?${filterQuery}&format=pdf`}>
          Xuất PDF
        </Button>
      </Space>
      {showStats && <TaskStatisticsModal query={filterQuery} onClose={() => setShowStats(false)} />}

      <Radio.Group
        optionType="button"
        buttonStyle="solid"
        value={state}
        onChange={(e) => {
          setState(e.target.value);
          setPage(1);
        }}
        options={[
          { value: 'ALL', label: `Tất cả${data ? ` (${total})` : ''}` },
          ...STATES.map((s) => ({ value: s, label: `${STATE_LABELS[s]}${data ? ` (${data.stateCounts[s]})` : ''}` })),
        ]}
      />

      {error && <Alert type="error" showIcon message={error} />}
      <AssignmentTable
        rows={data?.items ?? []}
        mode={scope}
        myPersonId={myPersonId}
        names={names}
        canReport={canReport}
        canConfirm={canConfirm}
        canAssign={canAssign}
        directReportIds={directReportIds}
        showTask
        loading={loading}
        emptyText={filtered ? 'Không có việc nào khớp bộ lọc.' : EMPTY_TEXT[scope]}
        onOpen={onOpen}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t, [from, to]) => `${from}–${to} / ${t} việc`,
          onChange: (p, size) => {
            setPage(size === pageSize ? p : 1);
            setPageSize(size);
          },
        }}
      />
    </Space>
  );
}
