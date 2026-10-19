import { Alert, Breadcrumb } from 'antd';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import ChangeHistoryButton from '@/components/change-history';
import PageTitle from '@/components/page-title';
import { fetchMe, fetchOrgTree, fetchProject, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { OrgUnit, ProjectDetail } from '@/lib/api';
import { holdersOf, uniqueByPerson } from '@/lib/org';
import ProjectActions from './project-actions';
import ProjectSections from './project-sections';
import ProjectView from './project-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let detail: ProjectDetail | null = null;
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    detail = await fetchProject(id);
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem hồ sơ này.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  if (!detail) {
    return (
      <>
        <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/projects">Đề án, dự án</Link> }, { title: 'Hồ sơ' }]} />
        <Alert type="error" message={error} showIcon />
      </>
    );
  }

  const { project } = detail;
  const people = uniqueByPerson(holdersOf(tree)).map((h) => ({ value: h.personId, label: `${h.fullName} – ${h.title}, ${h.unitName}` }));

  return (
    <>
      <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/projects">Đề án, dự án</Link> }, { title: project.code }]} />
      <PageTitle>{project.title}</PageTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <ProjectActions detail={detail} people={people} />
        <ChangeHistoryButton targetType="project" targetId={project.id} title={project.code} canView={me.permissions.includes('audit:read')} size="middle" />
      </div>
      <ProjectView detail={detail} />
      <ProjectSections detail={detail} people={people} myPersonId={me.personId} canReadAllMeetings={me.permissions.includes('meeting:read-all')} />
    </>
  );
}
