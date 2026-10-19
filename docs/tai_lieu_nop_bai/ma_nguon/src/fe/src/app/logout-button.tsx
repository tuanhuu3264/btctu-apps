'use client';

import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export default function LogoutButton() {
  const router = useRouter();

  async function logout() {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button type="button" onClick={logout}>
      Đăng xuất
    </button>
  );
}
