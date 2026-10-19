import { Alert } from 'antd';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchAssignment, fetchCatalogCurrent, fetchMe, fetchOrgTree, fetchWorkTasks, UnauthorizedError } from '@/lib/api';
import type { AssignmentView, CatalogCurrent, OrgUnit, SearchScope, WorkTask } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import TasksView from './tasks-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

/** Dấu thời điểm dựng trang: đổi mỗi lần máy chủ dựng lại (kể cả router.refresh) để các danh sách tải lại. */
const renderStamp = () => Date.now();

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams;
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('task:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem việc được giao." showIcon />;
  }

  const can = (p: string) => me.permissions.includes(p);
  const hasTeam = can('task:assign') || can('task:confirm');

  let teamTasks: WorkTask[] = [];
  let tree: OrgUnit[] = [];
  let catalog: CatalogCurrent | null = null;
  let initialOpen: AssignmentView | null = null;
  let error: string | null = null;
  try {
    // Mở sẵn một việc khi đi từ "Quản lý tài liệu" (?open=mã việc); không có quyền hoặc không có việc thì bỏ qua.
    if (open && /^[0-9a-f-]{36}$/i.test(open)) initialOpen = await fetchAssignment(open).catch(() => null);
    if (can('org:read')) tree = await fetchOrgTree();
    if (can('task:assign')) {
      teamTasks = await fetchWorkTasks('team');
      catalog = await fetchCatalogCurrent().catch(() => null);
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  const people = peopleIndex(tree);
  const names: Record<string, string> = Object.fromEntries([...people].map(([id, p]) => [id, p.fullName]));

  // Cấp dưới trực tiếp của vị trí mà người đăng nhập đang giữ: những người mình giao việc được.
  const placed = tree.flatMap((u) => u.positions.map((p) => ({ unitId: u.id, p })));
  const myPositionIds = new Set(placed.filter(({ p }) => me.personId && p.holder?.personId === me.personId).map(({ p }) => p.id));
  const assignees = placed
    .filter(({ p }) => p.holder && p.reportsToPositionId && myPositionIds.has(p.reportsToPositionId))
    .map(({ unitId, p }) => ({ personId: p.holder!.personId, label: `${p.holder!.fullName} – ${p.title}`, unitId, positionId: p.id }));

  const scopes: { key: SearchScope; label: string }[] = [
    { key: 'mine', label: 'Việc của tôi' },
    ...(hasTeam ? [{ key: 'team' as const, label: 'Việc của cấp dưới' }] : []),
    ...(can('task:confirm') ? [{ key: 'approving' as const, label: 'Chờ tôi duyệt' }] : []),
    { key: 'consulted', label: 'Được tham vấn' },
    ...(can('task:assign') ? [{ key: 'assigned' as const, label: 'Tôi đã giao' }] : []),
    ...(can('task:read-all') ? [{ key: 'all' as const, label: 'Tất cả' }] : []),
  ];

  return (
    <>
      <PageTitle>Việc được giao</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <TasksView
        myPersonId={me.personId}
        names={names}
        tree={tree}
        scopes={scopes}
        stamp={renderStamp()}
        initialOpen={initialOpen}
        teamTasks={teamTasks}
        assignees={assignees}
        myPositions={placed.filter(({ p }) => me.personId && p.holder?.personId === me.personId).map(({ p }) => ({ positionId: p.id, label: `${p.title}${p.holder?.kind === 'CONCURRENT' ? ' (kiêm nhiệm)' : ''}` }))}
        catalogItems={catalog?.items.filter((i) => i.coefficient !== null && i.coefficient > 0) ?? []}
        catalogGroups={catalog?.groups ?? []}
        catalogTasks={catalog?.tasks ?? []}
        canAssign={can('task:assign')}
        canConfirm={can('task:confirm')}
        canReport={can('task:report')}
      />
    </>
  );
}
