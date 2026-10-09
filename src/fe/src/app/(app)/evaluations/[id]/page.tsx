import { Alert, Breadcrumb } from 'antd';
import PageTitle from '@/components/page-title';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchCatalogVersion, fetchEvaluation, fetchMe, fetchOrgTree, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { CatalogItem, CatalogTask, EvaluationDetail, OrgUnit } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import { inScope, placementOf } from '@/lib/scope';
import EvaluationActions from './evaluation-actions';
import EvaluationView from './evaluation-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function EvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let detail: EvaluationDetail | null = null;
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    detail = await fetchEvaluation(id);
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem hồ sơ này.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  if (!detail) {
    return (
      <>
        <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/evaluations">Đánh giá theo kỳ</Link> }, { title: 'Hồ sơ' }]} />
        <Alert type="error" message={error} showIcon />
      </>
    );
  }

  // Danh sách nhiệm vụ để chọn khi giao chỉ tiêu: các công việc đã có điểm chấm trong danh mục của kỳ.
  let catalogItems: CatalogItem[] = [];
  let catalogGroups: { code: string; name: string }[] = [];
  let catalogTasks: CatalogTask[] = [];
  if (me.permissions.includes('evaluation:assign') && detail.period.catalogVersionId) {
    try {
      const version = await fetchCatalogVersion(detail.period.catalogVersionId);
      // Công việc có phạm vi chỉ hiện cho người thuộc phạm vi đó (ADR-021); không biết vị trí thì để máy chủ kiểm tra.
      const target = tree.length > 0 ? placementOf(tree, detail.evaluation.personId) : null;
      catalogItems = version.items.filter((i) => i.coefficient !== null && i.coefficient > 0 && (tree.length === 0 || inScope(i, target)));
      catalogGroups = version.groups;
      catalogTasks = version.tasks;
    } catch {
      catalogItems = [];
    }
  }

  const people = peopleIndex(tree);
  const nameOf = (personId: string | null) => (personId ? (people.get(personId)?.fullName ?? personId) : '(chưa xác định)');
  const { evaluation: ev, period, tasks } = detail;
  const subject = people.get(ev.personId) ?? null;

  return (
    <>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link href={`/evaluations?period=${period.id}`}>Đánh giá kỳ {period.label}</Link> }, { title: subject?.fullName ?? 'Hồ sơ' }]}
      />
      <PageTitle>Hồ sơ đánh giá: {subject?.fullName ?? ev.personId}</PageTitle>
      <EvaluationView detail={detail} subject={subject} reviewerName={nameOf(detail.reviewerPersonId)} approverName={nameOf(detail.approverPersonId)} />
      <EvaluationActions
        evaluationId={ev.id}
        status={ev.status}
        periodOpen={period.status === 'OPEN'}
        permissions={me.permissions}
        tasks={tasks}
        selfGeneralScore={ev.selfGeneralScore}
        isLeader={detail.isLeader}
        catalogItems={catalogItems}
        catalogGroups={catalogGroups}
        catalogTasks={catalogTasks}
        suggestedUnitResult={detail.leadershipSuggestion?.unitResult ?? null}
      />
    </>
  );
}
