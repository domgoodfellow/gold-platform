'use client';

import { Fragment, type ReactNode } from 'react';
import type { LocationNavigation } from '@/lib/shell';
import { AppShell } from './app-shell';
import { WorkspaceCrumbsProvider } from '../navigation/workspace-crumbs';
import { WorkspaceRailProvider, WorkspaceRightRail } from '../panels/workspace-right-rail';

/**
 * The one authenticated shell host. Organization pages, account pages, and global Platform
 * routes provide their own sidebar/header/bottom-bar content, while the rail host and main layout
 * geometry stay shared. A page's own identity is `PageHeader`, rendered by the page itself.
 */
export function WorkspaceShell({
  sidebar,
  locationNavigation,
  header,
  bottomBar,
  agent,
  children,
}: {
  sidebar: ReactNode;
  locationNavigation?: LocationNavigation;
  header: ReactNode;
  bottomBar?: ReactNode;
  agent: ReactNode;
  children: ReactNode;
}) {
  return (
    <WorkspaceRailProvider>
      <WorkspaceCrumbsProvider navigation={locationNavigation}>
        <WorkspaceRightRail
          bottomInset={bottomBar != null}
          main={
            <AppShell sidebar={sidebar} header={header} bottomBar={bottomBar}>
              {children}
            </AppShell>
          }
        />
        {/* `agent` is an element the calling layout created on the server, and sitting beside the
            rail as an unkeyed sibling trips React's dev key check on every render. */}
        <Fragment key="agent">{agent}</Fragment>
      </WorkspaceCrumbsProvider>
    </WorkspaceRailProvider>
  );
}
