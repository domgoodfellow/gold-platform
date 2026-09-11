'use client';

import type { CSSProperties, ReactNode } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

export function PlatformShell({ children, signOutAction }: { children: ReactNode; signOutAction: () => Promise<void> }) {
  return (
    <SidebarProvider style={{ '--header-height': '3.5rem' } as CSSProperties}>
      <AppSidebar signOutAction={signOutAction} />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <div className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
