'use client';

import type { ReactNode } from 'react';
import { Separator } from '@gold/ui/components/separator';
import { SidebarTrigger } from '@gold/ui/components/sidebar';
import { cx } from '../class-names';
import { AgentTrigger } from './workspace-right-rail';

/**
 * The sticky GLOBAL workspace bar, shared by Organization Context, Platform Context and Account:
 * it answers *which application am I in* and holds global utilities. It never says which page
 * or record you are on and never carries a page's actions — that is `PageHeader`, inside the
 * page. It holds no business identifier, no platform routing, no authorization, no Agent data.
 *
 * Left to right: the sidebar trigger, a mobile-only context control, a spacer, a mobile-only
 * account control, and Agent — always the furthest-right control. Sparse on desktop by design;
 * there is no filler here for a page to borrow.
 */
export function WorkspaceHeader({
  navigationTrigger,
  context,
  beforeActions,
}: {
  /**
   * 'always' — the sidebar trigger and its separator show at every width (Platform, whose
   * `Sidebar` renders an off-canvas Sheet at every width below `lg` and needs a trigger to open
   * it there). 'md' — both appear only from `md` up (Business, where a phone gets `OrgNavBar`
   * instead and the sidebar itself renders nothing below that width, per `AppShell`). Omit where
   * no sidebar sits behind this header.
   */
  navigationTrigger?: 'always' | 'md';
  /**
   * A mobile-only identity/context control — a compact context switcher — for a shell whose own
   * sidebar (and therefore its own switcher) is not reachable at this width. Absent where it is.
   */
  context?: ReactNode;
  /** Rendered immediately before Agent — a compact person control for a shell whose
   * sidebar-footer `AccountMenu` is not reachable at this width. */
  beforeActions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
      {navigationTrigger ? (
        <>
          <SidebarTrigger
            className={cx(navigationTrigger === 'md' ? 'hidden -ml-2 md:flex' : '-ml-1')}
          />
          <Separator
            orientation="vertical"
            className={cx(
              'data-[orientation=vertical]:h-4',
              navigationTrigger === 'md' ? 'hidden md:block' : undefined,
            )}
          />
        </>
      ) : null}
      {context}
      <span className="flex-1" />
      {beforeActions}
      <AgentTrigger />
    </header>
  );
}
