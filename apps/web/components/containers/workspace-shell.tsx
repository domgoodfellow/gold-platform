'use client';

import type { ReactNode } from 'react';
import { AppShell } from './app-shell';
import { WorkspaceRailProvider, WorkspaceRightRail } from './workspace-right-rail';
import { WorkspacePageChromeProvider } from './workspace-page-chrome';

/**
 * The one authenticated shell host. Organization pages, account pages, and global Platform
 * routes provide their own sidebar/header/bottom-bar content, while the rail host, page chrome
 * provider, and main layout geometry stay shared.
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
      <WorkspacePageChromeProvider>
        <WorkspaceRightRail
          main={
            <AppShell sidebar={sidebar} header={header} bottomBar={bottomBar}>
              {children}
            </AppShell>
          }
        />
        {agent}
      </WorkspacePageChromeProvider>
    </WorkspaceRailProvider>
  );
}
