'use client';

import { usePathname } from 'next/navigation';
import { Toaster } from '@gold/ui/components/sonner';

/** Preserve root feedback outside account shells; authenticated feedback lives in its scope. */
export function PublicFeedback() {
  const pathname = usePathname();
  const accountShell = ['/organizations', '/settings', '/platform'].some(root => pathname === root || pathname.startsWith(`${root}/`));
  return accountShell ? null : <Toaster />;
}
