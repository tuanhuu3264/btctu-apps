import { Alert, Breadcrumb } from 'antd';
import PageTitle from '@/components/page-title';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchComplaints, fetchMe, fetchOrgTree, fetchUnitEvaluation, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { OrgUnit, UnitComplaint, UnitEvaluationView } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import ComplaintsPanel from './complaints-panel';
import UnitEvaluationActions from './unit-evaluation-actions';
import UnitEvaluationDetail from './unit-evaluation-detail';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function UnitEvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let view: UnitEvaluationView | null = null;
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    view = await fetchUnitEvaluation(id);
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem hồ sơ này.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  if (!view) {
    return (
      <>
        <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/unit-evaluations">Đánh giá tập thể</Link> }, { title: 'Hồ sơ' }]} />
        <Alert type="error" message={error} showIcon />
      </>
    );
  }

  const people = peopleIndex(tree);
  const headName = view.headPersonId ? (people.get(view.headPersonId)?.fullName ?? view.headPersonId) : '(chưa có người đứng đầu)';
  const isHead = !!me.personId && me.personId === view.headPersonId;
  // Nội dung khiếu nại chỉ người có thẩm quyền xem (ADR-038 mục 6); máy chủ từ chối thì không hiện khung.
  let complaints: UnitComplaint[] | null = null;
  if (!isHead && ['complaint:manage', 'evaluation:review', 'evaluation:approve', 'evaluation:decide-ban'].some((p) => me.permissions.includes(p))) {
    complaints = await fetchComplaints(view.evaluation.id).catch(() => null);
  }

  return (
    <>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link href={`/unit-evaluations?period=${view.period.id}`}>Đánh giá tập thể năm {view.period.label}</Link> }, { title: view.unit.name }]}
      />
      <PageTitle>Hồ sơ tập thể: {view.unit.name}</PageTitle>
      <UnitEvaluationDetail view={view} headName={headName} />
      <UnitEvaluationActions
        evaluationId={view.evaluation.id}
        status={view.evaluation.status}
        periodOpen={view.period.status === 'OPEN'}
        permissions={me.permissions}
        isHead={isHead}
        isBan={view.unit.type === 'BAN'}
        selfGeneralScore={view.evaluation.selfGeneralScore}
        selfResultScore={view.evaluation.selfResultScore}
        axes={view.axes}
        suggested={view.suggested}
        selfAxisScores={view.evaluation.selfAxisScores}
      />
      <ComplaintsPanel
        evaluationId={view.evaluation.id}
        items={complaints}
        canRecord={me.permissions.includes('complaint:manage')}
        canDecide={!isHead && (me.permissions.includes('evaluation:approve') || me.permissions.includes('evaluation:decide-ban'))}
      />
    </>
  );
}
