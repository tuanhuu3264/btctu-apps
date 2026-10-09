import { Alert } from 'antd';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchMe, fetchOrgTree, fetchPersons, fetchPositions, UnauthorizedError } from '@/lib/api';
import type { OrgUnit, Person, Position } from '@/lib/api';
import OrganizationView from './organization-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function OrganizationPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('org:manage')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền quản lý cán bộ và cơ cấu tổ chức." showIcon />;
  }

  let tree: OrgUnit[] = [];
  let persons: Person[] = [];
  let positions: Position[] = [];
  let error: string | null = null;
  try {
    [tree, persons, positions] = await Promise.all([fetchOrgTree(), fetchPersons(), fetchPositions()]);
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <PageTitle>Quản lý cán bộ và cơ cấu tổ chức</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <OrganizationView tree={tree} persons={persons} positions={positions} />
    </>
  );
}
