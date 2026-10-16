import { Alert, Breadcrumb } from 'antd';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchMe, fetchUnitAxes, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { AxisDefinition } from '@/lib/api';
import AxesEditor from './axes-editor';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function UnitAxesPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let axes: AxisDefinition[] = [];
  let error: string | null = null;
  try {
    axes = await fetchUnitAxes();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem cấu hình này.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/unit-evaluations">Đánh giá tập thể</Link> }, { title: 'Trục chấm điểm' }]} />
      <PageTitle>Trục chấm điểm tập thể</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <AxesEditor initial={axes} canEdit={me.permissions.includes('evaluation:period-manage')} />
    </>
  );
}
