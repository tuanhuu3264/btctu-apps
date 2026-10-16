import { Alert } from 'antd';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchEvaluations, fetchMe, fetchOrgTree, fetchPeriods, UnauthorizedError } from '@/lib/api';
import type { EvaluationSummary, OrgUnit, Period } from '@/lib/api';
import { peopleIndex, positionIndex } from '@/lib/labels';
import EvaluationsView from './evaluations-view';
import type { Assignee } from './period-actions';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function EvaluationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  let evaluations: EvaluationSummary[] = [];
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    periods = await fetchPeriods();
    selected = periods.find((p) => p.id === requested) ?? periods[0];
    if (selected) evaluations = await fetchEvaluations(selected.id);
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }
  const people = peopleIndex(tree);

  // Cấp dưới trực tiếp của vị trí mà người đăng nhập đang giữ, chưa có hồ sơ trong kỳ.
  const withEvaluation = new Set(evaluations.map((ev) => `${ev.personId}|${ev.positionId}`));
  const positionInfo = positionIndex(tree);
  const positions = tree.flatMap((u) => u.positions);
  const myPositionIds = new Set(positions.filter((p) => me.personId && p.holder?.personId === me.personId).map((p) => p.id));
  const assignees: Assignee[] = positions
    .filter((p) => p.holder && p.reportsToPositionId && myPositionIds.has(p.reportsToPositionId) && !withEvaluation.has(`${p.holder.personId}|${p.id}`))
    .map((p) => ({ personId: p.holder!.personId, positionId: p.id, label: `${p.holder!.fullName} – ${p.title}${p.holder!.kind === 'CONCURRENT' ? ' (kiêm nhiệm)' : ''}` }));

  const rows = evaluations.map((ev) => ({
    ...ev,
    fullName: people.get(ev.personId)?.fullName ?? ev.personId,
    positionTitle: positionInfo.get(ev.positionId)?.title ?? people.get(ev.personId)?.positionTitle ?? '–',
    concurrent: tree.some((u) => u.positions.some((p) => p.id === ev.positionId && p.holder?.personId === ev.personId && p.holder.kind === 'CONCURRENT')),
  }));

  return (
    <>
      <PageTitle>Đánh giá theo kỳ</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <EvaluationsView
        periods={periods}
        selected={selected ?? null}
        rows={rows}
        assignees={assignees}
        names={Object.fromEntries([...people].map(([id, p]) => [id, p.fullName]))}
        canManagePeriod={me.permissions.includes('evaluation:period-manage')}
        canAssign={me.permissions.includes('evaluation:assign')}
      />
    </>
  );
}
