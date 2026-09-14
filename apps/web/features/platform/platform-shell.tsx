'use client';

import type { ReactNode } from 'react';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import type { SwitchableOrganization } from '@/components/containers/context-switcher';
import { PlatformAgentRail } from '@/features/agent/platform-agent-rail';

export function PlatformShell({
  children,
  email,
  signOutAction,
  businesses,
  canAnswerAgent,
}: {
  children: ReactNode;
  email: string;
  signOutAction: () => Promise<void>;
  businesses: SwitchableOrganization[];
  canAnswerAgent: boolean;
}) {
  return (
    <WorkspaceShell
      sidebar={<AppSidebar email={email} signOutAction={signOutAction} businesses={businesses} />}
      header={<SiteHeader />}
      agent={<PlatformAgentRail canAnswer={canAnswerAgent} />}
    >
      {children}
    </WorkspaceShell>
  );
}
