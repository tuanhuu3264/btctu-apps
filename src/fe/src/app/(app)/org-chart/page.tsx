import { Alert, Empty } from 'antd';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchMe, fetchOrgTree, UnauthorizedError } from '@/lib/api';
import type { OrgUnit } from '@/lib/api';
import OrgTree from '../org-tree';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let tree: OrgUnit[] = [];
  let error: string | null = null;
  const canRead = me.permissions.includes('org:read');
  if (canRead) {
    try {
      tree = await fetchOrgTree();
    } catch (e) {
      if (e instanceof UnauthorizedError) redirect('/login');
      error = e instanceof Error ? e.message : 'Lỗi không xác định';
    }
  }

  return (
    <>
      <PageTitle>Sơ đồ tổ chức</PageTitle>
      {error ? (
        <Alert type="error" message={error} showIcon />
      ) : !canRead ? (
        <Alert type="info" message="Tài khoản chưa được cấp vai trò để xem dữ liệu. Liên hệ quản trị hệ thống." showIcon />
      ) : tree.length === 0 ? (
        <Empty description="Chưa có dữ liệu tổ chức. Quản trị chạy lệnh nhập từ tệp Excel (xem README)." />
      ) : (
        <OrgTree units={tree} />
      )}
    </>
  );
}
