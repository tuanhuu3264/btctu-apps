import { Alert } from 'antd';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchDocCategories, fetchMe, fetchOrgTree, UnauthorizedError } from '@/lib/api';
import type { DocCategory, OrgUnit } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import DocumentsView from './documents-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  const can = (p: string) => me.permissions.includes(p);
  if (!can('document:read') && !can('task:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem tài liệu." showIcon />;
  }

  let tree: OrgUnit[] = [];
  let categories: DocCategory[] = [];
  let error: string | null = null;
  try {
    if (can('org:read')) tree = await fetchOrgTree();
    if (can('document:read')) categories = await fetchDocCategories();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }
  const names: Record<string, string> = Object.fromEntries([...peopleIndex(tree)].map(([id, p]) => [id, p.fullName]));

  return (
    <>
      <PageTitle>Quản lý tài liệu</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <DocumentsView names={names} categories={categories} canReadTasks={can('task:read')} canRead={can('document:read')} canManage={can('document:manage')} />
    </>
  );
}
