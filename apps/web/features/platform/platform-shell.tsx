'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/containers/app-shell';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';

export function PlatformShell({
  children,
  email,
  signOutAction,
}: {
  children: ReactNode;
  email: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <AppShell sidebar={<AppSidebar email={email} signOutAction={signOutAction} />} header={<SiteHeader />}>
      {children}
    </AppShell>
  );
}
