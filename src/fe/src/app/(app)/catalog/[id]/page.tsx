import { Alert, Breadcrumb } from 'antd';
import PageTitle from '@/components/page-title';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchCatalogVersion, fetchMe, fetchOrgTree, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { CatalogVersionView, OrgUnit } from '@/lib/api';
import VersionView from './version-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function CatalogVersionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let view: CatalogVersionView | null = null;
  let org: OrgUnit[] = [];
  let error: string | null = null;
  try {
    view = await fetchCatalogVersion(id);
    if (me.permissions.includes('org:read')) org = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem danh mục.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/catalog">Danh mục nhiệm vụ</Link> }, { title: view?.version.name ?? 'Phiên bản' }]} />
      {view ? (
        <>
          <PageTitle>{view.version.name}</PageTitle>
          <VersionView view={view} org={org} canManage={me.permissions.includes('catalog:manage')} canApprove={me.permissions.includes('catalog:approve')} />
        </>
      ) : (
        <Alert type="error" message={error} showIcon />
      )}
    </>
  );
}
