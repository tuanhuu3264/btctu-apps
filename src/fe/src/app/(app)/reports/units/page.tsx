import { Alert, Segmented } from 'antd';
import Link from 'next/link';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchMe, fetchPeriods, fetchUnitDraft, fetchUnitReport, UnauthorizedError } from '@/lib/api';
import type { Draft, Period, UnitReport } from '@/lib/api';
import UnitReportView from './unit-report-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function UnitReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('report:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem báo cáo." showIcon />;
  }

  const params = await searchParams;
  const requested = typeof params.period === 'string' ? params.period : undefined;

  let periods: Period[] = [];
  let report: UnitReport | null = null;
  let draft: Draft | null = null;
  let error: string | null = null;
  try {
    // Chỉ xếp loại tập thể theo năm (Nghị định 335 Điều 9.1).
    periods = (await fetchPeriods()).filter((p) => p.type === 'YEAR');
    const selected = periods.find((p) => p.id === requested) ?? periods[0];
    if (selected) {
      report = await fetchUnitReport(selected.id);
      if (me.permissions.includes('report:draft')) draft = await fetchUnitDraft(selected.id);
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
        value="units"
        options={[{ value: 'personal', label: <Link href="/reports">Cá nhân</Link> }, { value: 'units', label: 'Tập thể (phòng, Ban)' }]}
      />
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <UnitReportView periods={periods} report={report} draft={draft} canExport={me.permissions.includes('report:export')} />
    </>
  );
}
