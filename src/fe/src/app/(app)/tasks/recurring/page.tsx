import { Alert, Breadcrumb } from 'antd';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchCatalogCurrent, fetchMe, fetchOrgTree, fetchRecurring, fetchWorkTasks, UnauthorizedError } from '@/lib/api';
import type { CatalogCurrent, OrgUnit, RecurringTemplate, WorkTask } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import RecurringView from './recurring-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function RecurringPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('task:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem việc được giao." showIcon />;
  }
  const canAssign = me.permissions.includes('task:assign');

  let templates: RecurringTemplate[] = [];
  let tasks: WorkTask[] = [];
  let tree: OrgUnit[] = [];
  let catalog: CatalogCurrent | null = null;
  let error: string | null = null;
  try {
    templates = await fetchRecurring();
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
    if (canAssign) {
      tasks = await fetchWorkTasks('team');
      catalog = await fetchCatalogCurrent().catch(() => null);
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  const names: Record<string, string> = Object.fromEntries([...peopleIndex(tree)].map(([id, p]) => [id, p.fullName]));
  // Cấp dưới trực tiếp của vị trí mà người đăng nhập đang giữ: những người mình tạo mẫu cho được.
  const placed = tree.flatMap((u) => u.positions);
  const myPositionIds = new Set(placed.filter((p) => me.personId && p.holder?.personId === me.personId).map((p) => p.id));
  const assignees = placed
    .filter((p) => p.holder && p.reportsToPositionId && myPositionIds.has(p.reportsToPositionId))
    .map((p) => ({ personId: p.holder!.personId, label: `${p.holder!.fullName} – ${p.title}`, unitId: tree.find((u) => u.positions.some((x) => x.id === p.id))?.id ?? '', positionId: p.id }));

  return (
    <>
      <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/tasks">Việc được giao</Link> }, { title: 'Việc lặp định kỳ' }]} />
      <PageTitle>Việc lặp định kỳ</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <RecurringView
        templates={templates}
        names={names}
        tasks={tasks}
        assignees={assignees}
        catalogItems={catalog?.items.filter((i) => i.coefficient !== null && i.coefficient > 0) ?? []}
        canAssign={canAssign}
      />
    </>
  );
}
