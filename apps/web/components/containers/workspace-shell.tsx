'use client';

import type { ReactNode } from 'react';
import { AppShell } from './app-shell';
import { WorkspaceRailProvider, WorkspaceRightRail } from './workspace-right-rail';

/**
 * The one authenticated shell, shared by Organization Context and Platform Context (the
 * shell/context-model correction: Platform Administration was rendering the older `AppShell` +
 * `AppSidebar` + `SiteHeader` directly, with no rail at all, while the organization shell alone
 * had grown `WorkspaceRailProvider` + Agent + Configure — two shells silently diverging even
 * though nothing about the rail mechanism is organization-specific).
 *
 * `sidebar`/`header`/`bottomBar`/`children` are each shell's own — navigation, header content and
 * area are never generalized here (Business Context and Platform Context stay two different
 * navigation models, D23, `ui-spec.md` §1). What *is* shared is the rail host itself: the mode
 * switch between Agent and Configure, the dock/overlay/Drawer behaviour, and the resizable split.
 * `agent` is the one piece of content every caller must supply — a component that calls
 * `useAgentContent` and renders nothing itself (`AgentRail` for tenant scope, its platform
 * counterpart for Platform scope) — so the rail always has *some* Agent registered, never a
 * fake organization standing in for Platform Administration (constraints.md, this correction).
 */
export function WorkspaceShell({
  sidebar,
  header,
  bottomBar,
  agent,
  children,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  bottomBar?: ReactNode;
  agent: ReactNode;
  children: ReactNode;
}) {
  return (
    <WorkspaceRailProvider>
      <WorkspaceRightRail
        main={
          <AppShell sidebar={sidebar} header={header} bottomBar={bottomBar}>
            {children}
          </AppShell>
        }
      />
      {agent}
    </WorkspaceRailProvider>
  );
}
