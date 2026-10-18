import { Alert, Breadcrumb } from 'antd';
import ChangeHistoryButton from '@/components/change-history';
import PageTitle from '@/components/page-title';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchCatalogVersion, fetchEvaluation, fetchLeave, fetchMe, fetchOrgTree, fetchRatingEvents, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { CatalogItem, CatalogTask, EvaluationDetail, LeaveMonth, OrgUnit, RatingEvent } from '@/lib/api';
import { peopleIndex, positionIndex } from '@/lib/labels';
import { inScope, placementOf } from '@/lib/scope';
import EvaluationActions from './evaluation-actions';
import EvaluationView from './evaluation-view';
import LeaveEditor from './leave-editor';
import RatingEvents from './rating-events';
import ScoreInsight from './score-insight';

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
      catalogItems = version.items.filter((i) => i.status === 'ACTIVE' && i.coefficient !== null && i.coefficient > 0 && (tree.length === 0 || inScope(i, target)));
      catalogGroups = version.groups;
      catalogTasks = version.tasks;
    } catch {
      catalogItems = [];
    }
  }

  // Văn phòng ghi nhận tháng nghỉ cho hồ sơ năm chưa khóa (ADR-039).
  let leave: LeaveMonth[] | null = null;
  if (detail.yearAverage && detail.period.status === 'OPEN' && detail.evaluation.status !== 'APPROVED' && me.permissions.includes('evaluation:period-manage')) {
    leave = await fetchLeave(detail.evaluation.personId, detail.period.year ?? Number(detail.period.label)).catch(() => null);
  }

  // Kỷ luật, kết luận trong năm của kỳ (ADR-055); máy chủ chỉ trả cho cán bộ, cấp trên và người xem toàn bộ.
  const eventYear = detail.period.year ?? Number(detail.period.label.slice(0, 4));
  const ratingEvents: RatingEvent[] = await fetchRatingEvents(detail.evaluation.personId, eventYear).catch(() => []);

  const people = peopleIndex(tree);
  const nameOf = (personId: string | null) => (personId ? (people.get(personId)?.fullName ?? personId) : '(chưa xác định)');
  const { evaluation: ev, period, tasks } = detail;
  const person = people.get(ev.personId) ?? null;
  const position = positionIndex(tree).get(ev.positionId);
  const concurrent = tree.some((u) => u.positions.some((p) => p.id === ev.positionId && p.holder?.personId === ev.personId && p.holder.kind === 'CONCURRENT'));
  // Phiếu gắn với một vị trí cụ thể: cán bộ kiêm nhiệm có phiếu riêng cho từng vị trí (ADR-047).
  const subject = person ? { fullName: person.fullName, positionTitle: `${position?.title ?? person.positionTitle}${concurrent ? ' (kiêm nhiệm)' : ''}` } : null;

  return (
    <>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link href={`/evaluations?period=${period.id}`}>Đánh giá kỳ {period.label}</Link> }, { title: subject?.fullName ?? 'Hồ sơ' }]}
      />
      <PageTitle>Hồ sơ đánh giá: {subject?.fullName ?? ev.personId}</PageTitle>
      <div style={{ marginBottom: 12 }}>
        <ChangeHistoryButton targetType="evaluation" targetId={ev.id} title={subject?.fullName ?? 'Hồ sơ'} canView={me.permissions.includes('audit:read')} size="middle" />
      </div>
      <EvaluationView detail={detail} subject={subject} reviewerName={nameOf(detail.reviewerPersonId)} approverName={nameOf(detail.approverPersonId)} />
      {period.type !== 'YEAR' && !detail.isSupport && tasks.length > 0 && <ScoreInsight evaluationId={ev.id} />}
      <EvaluationActions
        evaluationId={ev.id}
        status={ev.status}
        periodOpen={period.status === 'OPEN'}
        permissions={me.permissions}
        tasks={tasks}
        selfGeneralScore={ev.selfGeneralScore}
        isLeader={detail.isLeader}
        isSupport={detail.isSupport}
        selfSupport={ev.selfSupport}
        generalCriteria={detail.generalCriteria}
        selfGeneral={ev.selfGeneral?.items ?? null}
        previous={detail.previous}
        forcedItems={detail.forcedItems}
        yearConditions={detail.yearConditions}
        isYear={period.type === 'YEAR'}
        yearEnough={detail.yearAverage?.enough ?? true}
        catalogItems={catalogItems}
        catalogGroups={catalogGroups}
        catalogTasks={catalogTasks}
        suggestedUnitResult={detail.leadershipSuggestion?.unitResult ?? null}
        suggestedSolidarity={detail.leadershipSuggestion?.solidarity != null ? { value: detail.leadershipSuggestion.solidarity, reason: detail.leadershipSuggestion.solidarityReason ?? '' } : null}
      />
      <RatingEvents personId={ev.personId} year={eventYear} events={ratingEvents} canEdit={me.permissions.includes('evaluation:period-manage') && period.status === 'OPEN'} />
      {leave && detail.yearAverage && (
        <LeaveEditor personId={ev.personId} year={period.year ?? Number(period.label)} initial={leave} approvedMonths={detail.yearAverage.months.map((m) => m.month)} />
      )}
    </>
  );
}
