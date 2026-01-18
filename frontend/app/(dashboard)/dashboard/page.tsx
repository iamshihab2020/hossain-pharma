'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUserRole } from '@/lib/stores/auth-store';

export default function DashboardPage() {
  const router = useRouter();
  const role = useUserRole();

  useEffect(() => {
    // Redirect based on role
    if (role === 'admin' || role === 'seller') {
      router.replace('/dashboard/overview');
    } else {
      router.replace('/dashboard/orders');
    }
  }, [role, router]);

  return null;
}
