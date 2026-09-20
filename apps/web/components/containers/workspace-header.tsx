'use client';

import type { ReactNode } from 'react';
import { Separator } from '@gold/ui/components/separator';
import { SidebarTrigger } from '@gold/ui/components/sidebar';
import { cx } from '../class-names';
import { WorkspaceCrumbSlot } from './workspace-crumbs';
import { AgentTrigger } from './workspace-right-rail';

/**
 * The sticky GLOBAL workspace bar, shared by Organization Context, Platform Context and Account:
 * it answers *where am I* (the breadcrumb trail) and holds global utilities. It carries no page
 * title and no page actions — those are `PageHeader`, inside the page. The trail is written by
 * the page (`PageHeader`'s `crumbs`) into the slot here. It holds no business identifier, no
 * platform routing, no authorization, no Agent data.
 *
 * Left to right: the sidebar trigger, a mobile-only context control, the breadcrumb slot, a
 * spacer, a mobile-only account control, and Agent — always the furthest-right control.
 */
export function WorkspaceHeader({
  navigationTrigger,
  context,
  beforeActions,
}: {
  /**
   * 'md' — the sidebar trigger and its separator appear only from `md` up. Business *and*
   * Platform Context use this: Platform is GOLD's own organization shell, so a phone gets the
   * bottom bar (`OrgNavBar`, which puts Platform first while in Platform Context) and the
   * sidebar itself renders nothing below that width, per `AppShell`.
   * 'always' — the trigger shows at every width, for a shell with no bottom bar whose only phone
   * navigation *is* the sidebar's off-canvas Sheet (Personal settings and the fallback frame).
   * Omit where no sidebar sits behind this header.
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
      <WorkspaceCrumbSlot />
      <span className="flex-1" />
      {beforeActions}
      <AgentTrigger />
    </header>
  );
}
