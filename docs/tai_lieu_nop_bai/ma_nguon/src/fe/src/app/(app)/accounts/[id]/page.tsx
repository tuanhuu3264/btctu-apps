import { Alert, Breadcrumb, Descriptions, Tag } from 'antd';
import PageTitle from '@/components/page-title';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchAccountRoles, fetchAccounts, fetchMe, fetchOrgTree, UnauthorizedError } from '@/lib/api';
import type { AccountSummary, OrgUnit, RoleAssignment } from '@/lib/api';
import { peopleIndex } from '@/lib/labels';
import AccountActions from './account-actions';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await fetchMe().catch((e) => {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  });

  let account: AccountSummary | undefined;
  let roles: RoleAssignment[] = [];
  let tree: OrgUnit[] = [];
  let error: string | null = null;
  try {
    account = (await fetchAccounts()).find((a) => a.id === id);
    if (account && me.permissions.includes('role:read')) roles = await fetchAccountRoles(id);
    if (me.permissions.includes('org:read')) tree = await fetchOrgTree();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    error = e instanceof Error ? e.message : 'Lỗi không xác định';
  }

  const people = peopleIndex(tree);
  const persons = [...people.entries()].map(([personId, p]) => ({ personId, label: `${p.fullName} – ${p.positionTitle} (${p.unitName})` }));
  const person = account?.personId ? people.get(account.personId) : undefined;

  return (
    <>
      <Breadcrumb style={{ marginBottom: 12 }} items={[{ title: <Link href="/accounts">Tài khoản</Link> }, { title: account?.username ?? 'Chi tiết' }]} />
      {!account ? (
        <Alert type="error" message={error ?? 'Không tìm thấy tài khoản.'} showIcon />
      ) : (
        <>
          <PageTitle>Tài khoản {account.username}</PageTitle>
          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, md: 2 }}
            style={{ marginBottom: 16, background: '#fff' }}
            items={[
              { key: 's', label: 'Trạng thái', children: account.status === 'ACTIVE' ? <Tag color="green">Đang hoạt động</Tag> : <Tag color="red">Đã khóa</Tag> },
              {
                key: 'p',
                label: 'Cán bộ',
                children: account.personId ? (person ? `${person.fullName} – ${person.positionTitle}` : account.personId) : <Tag>chưa gắn</Tag>,
              },
            ]}
          />
          <AccountActions accountId={account.id} status={account.status} linkedPersonId={account.personId} persons={persons} roles={roles} permissions={me.permissions} />
        </>
      )}
    </>
  );
}
