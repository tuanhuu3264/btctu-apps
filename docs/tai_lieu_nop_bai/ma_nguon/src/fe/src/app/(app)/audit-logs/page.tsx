import { Alert } from 'antd';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchAuditActions, fetchAuditFacets, fetchAuditLogs, fetchMe, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { AuditEntry } from '@/lib/api';
import AuditView from './audit-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const ONE_DAY_MS = 24 * 3600 * 1000;
const OUTCOMES = ['SUCCESS', 'DENIED', 'FAILURE'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const one = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

/** Ngày theo giờ Việt Nam (UTC+7): từ đầu ngày `from` đến hết ngày `to`. */
function rangeOf(from?: string, to?: string): { from?: string; to?: string } {
  const out: { from?: string; to?: string } = {};
  if (from && DATE.test(from)) out.from = new Date(`${from}T00:00:00+07:00`).toISOString();
  if (to && DATE.test(to)) out.to = new Date(new Date(`${to}T00:00:00+07:00`).getTime() + ONE_DAY_MS).toISOString();
  return out;
}

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('audit:read')) {
    return <Alert type="warning" message="Chỉ tài khoản quản trị dữ liệu được xem nhật ký hoạt động." showIcon />;
  }

  const params = await searchParams;
  const filters = {
    action: one(params.action),
    outcome: OUTCOMES.includes(one(params.outcome) ?? '') ? one(params.outcome) : undefined,
    username: one(params.username),
    module: one(params.module),
    type: one(params.type),
    targetType: one(params.targetType),
    targetId: one(params.targetId),
    from: one(params.from),
    to: one(params.to),
  };

  const query = new URLSearchParams();
  if (filters.action) query.set('action', filters.action);
  if (filters.outcome) query.set('outcome', filters.outcome);
  if (filters.username) query.set('username', filters.username);
  if (filters.module) query.set('module', filters.module);
  if (filters.type) query.set('type', filters.type);
  if (filters.targetType) query.set('targetType', filters.targetType);
  if (filters.targetId) query.set('targetId', filters.targetId);
  const range = rangeOf(filters.from, filters.to);
  if (range.from) query.set('from', range.from);
  if (range.to) query.set('to', range.to);
  const baseQuery = query.toString();
  query.set('limit', String(PAGE_SIZE));

  let rows: AuditEntry[] = [];
  let actions: string[] = [];
  let facets: { modules: string[]; types: string[] } = { modules: [], types: [] };
  let error: string | null = null;
  try {
    [rows, actions, facets] = await Promise.all([fetchAuditLogs(query.toString()), fetchAuditActions(), fetchAuditFacets()]);
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem nhật ký.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <PageTitle>Nhật ký hoạt động</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <AuditView
        // Đổi bộ lọc thì dựng lại để danh sách "tải thêm" bắt đầu từ trang đầu mới.
        key={`${baseQuery}`}
        initialRows={rows}
        actions={actions}
        facets={facets}
        filters={filters}
        baseQuery={baseQuery}
        pageSize={PAGE_SIZE}
      />
    </>
  );
}
