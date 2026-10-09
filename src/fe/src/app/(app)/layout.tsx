import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { fetchMe, UnauthorizedError } from '@/lib/api';
import type { Me } from '@/lib/api';
import AppShell from './app-shell';

// Dữ liệu lấy từ backend mỗi lần truy cập, không dựng sẵn lúc build.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  let me: Me;
  try {
    me = await fetchMe();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect('/login');
    throw e;
  }
  return <AppShell me={me}>{children}</AppShell>;
}
