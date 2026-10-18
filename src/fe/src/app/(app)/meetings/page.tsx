import { Alert } from 'antd';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchMe, fetchOrgTree, UnauthorizedError } from '@/lib/api';
import type { OrgUnit } from '@/lib/api';
import { holdersOf, uniqueByPerson } from '@/lib/org';
import MeetingsView from './meetings-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function MeetingsPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  const can = (p: string) => me.permissions.includes(p);
  // Lịch họp gắn với cán bộ (người được mời, chủ trì), nên cần tài khoản đã gắn với cán bộ.
  if (!me.personId) return <Alert type="warning" message="Tài khoản chưa gắn với cán bộ nên chưa có lịch họp nào." showIcon />;

  let tree: OrgUnit[] = [];
  let error: string | null = null;
  if (can('org:read')) {
    try {
      tree = await fetchOrgTree();
    } catch (e) {
      if (e instanceof UnauthorizedError) redirect('/login');
      error = e instanceof Error ? e.message : 'Lỗi không xác định';
    }
  }
  const people = uniqueByPerson(holdersOf(tree)).map((h) => ({ value: h.personId, label: `${h.fullName} – ${h.title}, ${h.unitName}` }));

  return (
    <>
      <PageTitle>Lịch họp</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <MeetingsView people={people} myPersonId={me.personId} canReadAll={can('meeting:read-all')} canManageRooms={can('meeting:manage-rooms')} />
    </>
  );
}
