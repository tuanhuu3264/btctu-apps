import { Alert } from 'antd';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchMe, fetchOrgTree, fetchPeriods, fetchUnitEvaluations, UnauthorizedError } from '@/lib/api';
import type { OrgUnit, Period, UnitEvaluationView } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import UnitEvaluationsView from './unit-evaluations-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function UnitEvaluationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('evaluation:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem hồ sơ đánh giá." showIcon />;
  }

  const params = await searchParams;
  const requested = typeof params.period === 'string' ? params.period : undefined;

  let periods: Period[] = [];
  let selected: Period | undefined;
  let rows: UnitEvaluationView[] = [];
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    // Chỉ xếp loại tập thể theo năm (Nghị định 335 Điều 9.1).
    periods = (await fetchPeriods()).filter((p) => p.type === 'YEAR');
    selected = periods.find((p) => p.id === requested) ?? periods[0];
    if (selected) rows = await fetchUnitEvaluations(selected.id);
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }
  const people = peopleIndex(tree);

  return (
    <>
      <PageTitle>Đánh giá tập thể</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <UnitEvaluationsView
        periods={periods}
        selected={selected ?? null}
        rows={rows.map((r) => ({ ...r, headName: r.headPersonId ? (people.get(r.headPersonId)?.fullName ?? '–') : '(chưa có người đứng đầu)' }))}
        canManagePeriod={me.permissions.includes('evaluation:period-manage')}
      />
    </>
  );
}
