'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/containers/app-shell';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import type { SwitchableOrganization } from '@/components/containers/context-switcher';

export function PlatformShell({
  children,
  email,
  signOutAction,
  businesses,
}: {
  children: ReactNode;
  email: string;
  signOutAction: () => Promise<void>;
  businesses: SwitchableOrganization[];
}) {
  return (
    <AppShell
      sidebar={<AppSidebar email={email} signOutAction={signOutAction} businesses={businesses} />}
      header={<SiteHeader />}
    >
      {children}
    </AppShell>
  );
}
