import { Alert } from 'antd';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchCatalogVersions, UnauthorizedError } from '@/lib/api';
import type { CatalogVersion } from '@/lib/api';
import { fetchMe } from '@/lib/api';
import CreateVersionForm from './create-version-form';
import VersionsTable from './versions-table';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function CatalogPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('catalog:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem danh mục." showIcon />;
  }

  let versions: CatalogVersion[] = [];
  let error: string | null = null;
  try {
    versions = await fetchCatalogVersions();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <PageTitle flush>
          Danh mục sản phẩm, công việc chuẩn
        </PageTitle>
        {me.permissions.includes('catalog:manage') && <CreateVersionForm versions={versions.map((v) => ({ id: v.id, label: v.label, name: v.name }))} />}
      </div>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <VersionsTable versions={versions} />
    </>
  );
}
