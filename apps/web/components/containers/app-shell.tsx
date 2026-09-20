'use client';

import type { ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@gold/ui/components/sidebar';
import { cx } from '../class-names';
import { PAGE_PADDING } from './workspace-geometry';
import { PagePanel } from './workspace-right-rail';

/**
 * The two-column frame every shell renders inside: a `Sidebar` the caller builds (each shell
 * owns its own navigation) and a scrolling main slot. State — open/collapsed, icon rail,
 * mobile sheet — is `SidebarProvider`'s own, the same one the platform console already used;
 * this is that primitive promoted to both shells rather than the operator half of it staying a
 * bespoke `localStorage` implementation beside it.
 *
 * `bottomBar` is a phone-only sibling of `SidebarInset`, never a child of the `Sidebar` itself.
 * shadcn's own mobile rendering is an off-canvas sheet, and `ui-spec.md` §2 refuses a phone
 * drawer outright — "needs a toggle, a focus trap and an escape key to be correct" — so a
 * caller that passes `bottomBar` must never also give the sidebar a trigger reachable below
 * `md`: with no trigger, `Sidebar`'s own mobile branch mounts a closed sheet and renders
 * nothing, and the bottom bar is what a phone actually sees.
 */
export function AppShell({
  sidebar,
  header,
  bottomBar,
  children,
}: {
  sidebar: ReactNode;
  header: ReactNode;
  bottomBar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      {sidebar}
      <SidebarInset className="min-w-0">
        {header}
        {/* Beneath the workspace header, beside the page: the page drawer lives here, so it starts
            under the header and the page stays visible next to it. */}
        <div className="flex min-w-0 flex-1">
          <div className={cx('min-w-0 flex-1', PAGE_PADDING, bottomBar ? 'pb-24 md:pb-6' : undefined)}>
            {children}
          </div>
          <PagePanel />
        </div>
      </SidebarInset>
      {bottomBar}
    </SidebarProvider>
  );
}
