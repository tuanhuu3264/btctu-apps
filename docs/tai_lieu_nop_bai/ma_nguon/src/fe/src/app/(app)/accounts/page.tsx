import { Alert } from 'antd';
import PageTitle from '@/components/page-title';
import { redirect } from 'next/navigation';
import { fetchAccounts, fetchMe, fetchOrgTree, UnauthorizedError } from '@/lib/api';
import type { AccountSummary, OrgUnit } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import CreateAccountForm from './create-account-form';
import AccountsTable from './accounts-table';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });
  if (!me.permissions.includes('account:read')) {
    return <Alert type="warning" message="Tài khoản chưa được cấp quyền xem danh sách tài khoản." showIcon />;
  }

  let accounts: AccountSummary[] = [];
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    accounts = await fetchAccounts();
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }
  const people = peopleIndex(tree);
  const rows = accounts.map((a) => ({ ...a, personName: a.personId ? (people.get(a.personId)?.fullName ?? a.personId) : null }));

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <PageTitle flush>
          Tài khoản và vai trò
        </PageTitle>
        {me.permissions.includes('account:create') && <CreateAccountForm />}
      </div>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <AccountsTable rows={rows} />
    </>
  );
}
