import { Alert } from 'antd';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchAssignments, fetchMe, fetchOkr, fetchOrgTree, UnauthorizedError } from '@/lib/api';
import type { AssignmentView, Okr, OrgUnit } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import OkrView from './okr-view';
import type { OkrGroup } from './okr-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

const EMPTY: Okr = { raw: '', objective: null, keyResults: [] };

export default async function OkrPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  const can = (p: string) => me.permissions.includes(p);
  if (!can('task:read')) return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem việc được giao." showIcon />;

  const hasTeam = can('task:assign') || can('task:confirm');
  const { scope: requested } = await searchParams;
  const scope = requested === 'team' && hasTeam ? 'team' : 'mine';

  let groups: OkrGroup[] = [];
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    if (can('org:read')) tree = await fetchOrgTree();
    const views: AssignmentView[] = await fetchAssignments(scope);
    const names = new Map([...peopleIndex(tree)].map(([id, p]) => [id, p.fullName]));

    if (scope === 'mine') {
      const okr = me.personId ? await fetchOkr(me.personId).catch(() => EMPTY) : EMPTY;
      groups = [{ personId: me.personId ?? 'me', name: me.personId ? (names.get(me.personId) ?? 'Tôi') : 'Tôi', okr, views }];
    } else {
      const byPerson = new Map<string, AssignmentView[]>();
      for (const v of views) byPerson.set(v.assignment.assigneePersonId, [...(byPerson.get(v.assignment.assigneePersonId) ?? []), v]);
      groups = await Promise.all(
        [...byPerson].map(async ([personId, list]) => ({
          personId,
          name: names.get(personId) ?? 'Không rõ',
          okr: await fetchOkr(personId).catch(() => EMPTY),
          views: list,
        })),
      );
      groups.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <PageTitle>OKR theo dõi</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <OkrView scope={scope} hasTeam={hasTeam} groups={groups} />
    </>
  );
}
