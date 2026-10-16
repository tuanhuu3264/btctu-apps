import { Alert } from 'antd';
import { redirect } from 'next/navigation';
import PageTitle from '@/components/page-title';
import { fetchAccessReview, fetchAccessReviews, fetchAccessReviewSuggestion, fetchMe, ForbiddenError, UnauthorizedError } from '@/lib/api';
import type { AccessReviewDetail, AccessReviewSuggestion, AccessReviewView } from '@/lib/api';
import AccessReviewsView from './access-reviews-view';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function AccessReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  const can = (p: string) => me.permissions.includes(p);
  if (!can('access-review:manage') && !can('access-review:confirm') && !can('access-review:oversee')) {
    return <Alert type="warning" message="Tài khoản chưa được giao việc rà soát quyền." showIcon />;
  }

  const params = await searchParams;
  const open = typeof params.open === 'string' && /^[0-9a-f-]{36}$/i.test(params.open) ? params.open : undefined;

  let reviews: AccessReviewView[] = [];
  let detail: AccessReviewDetail | null = null;
  let suggestion: AccessReviewSuggestion | null = null;
  let error: string | null = null;
  try {
    reviews = await fetchAccessReviews();
    if (open) detail = await fetchAccessReview(open);
    if (can('access-review:manage')) suggestion = await fetchAccessReviewSuggestion();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof ForbiddenError ? 'Bạn không có quyền xem đợt rà soát này.' : e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  return (
    <>
      <PageTitle>Rà soát quyền định kỳ</PageTitle>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <AccessReviewsView
        reviews={reviews}
        detail={detail}
        suggestion={suggestion}
        canManage={can('access-review:manage')}
        canExport={can('access-review:manage') || can('access-review:oversee')}
      />
    </>
  );
}
