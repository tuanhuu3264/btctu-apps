import { Alert } from 'antd';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchDashboard, fetchMe, fetchPeriods, UnauthorizedError } from '@/lib/api';
import type { Period, PeriodReport } from '@/lib/api';
import type { DashboardMode } from '@/components/dashboard-panels';
import DashboardView from './dashboard-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  const can = (p: string) => me.permissions.includes(p);
  const params = await searchParams;
  const requested = typeof params.period === 'string' ? params.period : undefined;

  let periods: Period[] = [];
  let report: PeriodReport | null = null;
  let error: string | null = null;
  if (can('report:read')) {
    try {
      periods = await fetchPeriods();
      const selected = periods.find((p) => p.id === requested) ?? periods[0];
      if (selected) report = await fetchDashboard(selected.id);
    } catch (e) {
      if (e instanceof UnauthorizedError) redirect('/login');
      error = e instanceof Error ? e.message : 'Lỗi không xác định';
    }
  }

  const nothing = !can('task:read') && !can('report:read');
  // Góc nhìn: toàn Ban khi xem được toàn bộ hồ sơ; phòng khi có cấp dưới (giao việc, thẩm định); còn lại là cá nhân.
  const mode: DashboardMode = report?.scope === 'ALL' ? 'BAN' : can('task:assign') || can('evaluation:review') ? 'PHONG' : 'CA_NHAN';
  const deadline = periods.find((p) => p.id === report?.period.id)?.deadline ?? null;
  return (
    <>
      <PageTitle>Tổng quan</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      {nothing ? (
        <Alert type="info" message="Tài khoản chưa được cấp vai trò để xem dữ liệu. Liên hệ quản trị hệ thống." showIcon />
      ) : (
        <DashboardView
          canTasks={can('task:read')}
          canProjects={!!me.personId}
          canMeetings={!!me.personId}
          canReadAllProjects={can('project:read-all')}
          canReadAllTasks={can('task:read-all')}
          canReviews={can('access-review:manage') || can('access-review:confirm') || can('access-review:oversee')}
          mode={mode}
          myPersonId={me.personId}
          deadline={deadline}
          periods={periods}
          report={report}
        />
      )}
    </>
  );
}
