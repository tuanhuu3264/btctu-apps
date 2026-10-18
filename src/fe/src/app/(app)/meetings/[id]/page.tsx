import { Alert, Breadcrumb } from 'antd';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ChangeHistoryButton from '@/components/change-history';
import PageTitle from '@/components/page-title';
import { fetchMe, fetchMeeting, fetchOrgTree, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { MeetingDetail, OrgUnit } from '@/lib/api';
import { holdersOf, uniqueByPerson } from '@/lib/org';
import MeetingActions from './meeting-actions';
import MeetingSections from './meeting-sections';
import MeetingView from './meeting-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let detail: MeetingDetail | null = null;
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    detail = await fetchMeeting(id);
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem cuộc họp này.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  if (!detail) {
    return (
      <>
        <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/meetings">Lịch họp</Link> }, { title: 'Cuộc họp' }]} />
        <Alert type="error" message={error} showIcon />
      </>
    );
  }

  const { meeting } = detail;
  const people = uniqueByPerson(holdersOf(tree)).map((h) => ({ value: h.personId, label: `${h.fullName} – ${h.title}, ${h.unitName}` }));

  return (
    <>
      <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/meetings">Lịch họp</Link> }, { title: 'Cuộc họp' }]} />
      <PageTitle>{meeting.title}</PageTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <MeetingActions detail={detail} people={people} myPersonId={me.personId ?? ''} />
        <ChangeHistoryButton targetType="meeting" targetId={meeting.id} title={meeting.title} canView={me.permissions.includes('audit:read')} size="middle" />
      </div>
      <MeetingView detail={detail} />
      <MeetingSections detail={detail} myPersonId={me.personId} />
    </>
  );
}
