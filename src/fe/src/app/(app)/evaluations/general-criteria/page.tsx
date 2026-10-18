import { Alert, Breadcrumb } from 'antd';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchGeneralCriteria, fetchMe, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { GeneralCriteriaVersion } from '@/lib/api';
import CriteriaVersions from './criteria-versions';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function GeneralCriteriaPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let versions: GeneralCriteriaVersion[] = [];
  let error: string | null = null;
  try {
    versions = await fetchGeneralCriteria();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem cấu hình này.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/evaluations">Đánh giá theo kỳ</Link> }, { title: 'Bảng tiêu chí chung' }]} />
      <PageTitle>Bảng tiêu chí chung (30 điểm) của cá nhân</PageTitle>
      {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 16 }} />}
      {!error && <CriteriaVersions versions={versions} canEdit={me.permissions.includes('evaluation:period-manage')} />}
    </>
  );
}
