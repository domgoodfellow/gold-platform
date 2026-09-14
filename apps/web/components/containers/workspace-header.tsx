'use client';

import type { ReactNode } from 'react';
import { Separator } from '@gold/ui/components/separator';
import { SidebarTrigger } from '@gold/ui/components/sidebar';
import { cx } from '../class-names';
import { WorkspaceHeaderActions } from './workspace-right-rail';
import { PageChromeIdentity, usePageChrome } from './workspace-page-chrome';

/**
 * Header GEOMETRY only, shared by Organization Context and Platform Context — the fix for two
 * header implementations (the inline `<header>` the per-business layout used to hand-write, and
 * the Platform-only `SiteHeader`) quietly drifting apart. What sits inside each
 * slot is entirely the caller's: an area's breadcrumb, a platform page's title, a Setup badge.
 * This component holds none of that — no business identifier, no platform routing, no per-area
 * breadcrumb logic, no authorization, no Agent data.
 *
 * LEFT reads identity/navigation — where am I, which business, which area. RIGHT is personal and
 * secondary controls, ending in Configure then Agent — `WorkspaceHeaderActions`' own order, never
 * reimplemented here. Agent is always the furthest-right workspace control.
 *
 * A page that has registered chrome (`useWorkspacePageChrome`/`PageChromeRegistrar`, e.g. a
 * detail route's former `RecordHeader`, or a Platform page's breadcrumb) takes over `primary`,
 * `status` and gets a page-actions slot ahead of everything else on the right — this is what
 * makes the header authoritative for page location instead of a second heading in the body.
 * Absent that registration, `primary`/`status` fall back to whatever the caller passed in (a
 * business area's own breadcrumb, a Platform static title).
 */
export function WorkspaceHeader({
  navigationTrigger,
  context,
  primary,
  status,
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
  primary: ReactNode;
  status?: ReactNode;
  /** Rendered immediately before Configure/Agent — a compact person control for a shell whose
   * sidebar-footer `AccountMenu` is not reachable at this width. */
  beforeActions?: ReactNode;
}) {
  const chrome = usePageChrome();

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
      {chrome ? <PageChromeIdentity chrome={chrome} /> : primary}
      {chrome?.status ? (
        <div className="hidden max-w-[16rem] shrink truncate text-sm text-muted sm:block">
          {chrome.status}
        </div>
      ) : (
        status
      )}
      <span className="flex-1" />
      {chrome?.actions ? (
        <div className="flex shrink-0 items-center gap-2">{chrome.actions}</div>
      ) : null}
      {beforeActions}
      <WorkspaceHeaderActions />
    </header>
  );
}
