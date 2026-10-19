import { Alert, Segmented } from 'antd';
import Link from 'next/link';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchDashboard, fetchDraft, fetchMe, fetchPeriods, UnauthorizedError } from '@/lib/api';
import type { Draft, PeriodReport } from '@/lib/api';
import ReportView from './report-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('report:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem báo cáo." showIcon />;
  }

  const params = await searchParams;
  const requested = typeof params.period === 'string' ? params.period : undefined;

  let periods: Awaited<ReturnType<typeof fetchPeriods>> = [];
  let report: PeriodReport | null = null;
  let drafts: { report: Draft | null; decision: Draft | null; notice: Draft | null } = { report: null, decision: null, notice: null };
  let error: string | null = null;
  try {
    periods = await fetchPeriods();
    const selected = periods.find((p) => p.id === requested) ?? periods[0];
    if (selected) {
      report = await fetchDashboard(selected.id);
      if (me.permissions.includes('report:draft')) {
        drafts = { report: await fetchDraft(selected.id, 'report'), decision: await fetchDraft(selected.id, 'decision'), notice: await fetchDraft(selected.id, 'notice') };
      }
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <PageTitle>Báo cáo kết quả đánh giá</PageTitle>
      <Segmented
        style={{ marginBottom: 16 }}
        value="personal"
        options={[{ value: 'personal', label: 'Cá nhân' }, { value: 'units', label: <Link href="/reports/units">Tập thể (phòng, Ban)</Link> }]}
      />
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <ReportView periods={periods} report={report} drafts={drafts} canExport={me.permissions.includes('report:export')} />
    </>
  );
}
