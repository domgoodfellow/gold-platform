'use client';

import { Fragment, type ReactNode } from 'react';
import { SidebarInset, SidebarProvider } from '@gold/ui/components/sidebar';
import { cx } from '../class-names';
import { PAGE_PADDING } from './workspace-geometry';
import { PagePanel } from '../panels/workspace-right-rail';

/**
 * The two-column frame every shell renders inside: a `Sidebar` the caller builds (each shell
 * owns its own navigation) and a scrolling main slot. State — open/collapsed, icon rail,
 * mobile sheet — is `SidebarProvider`'s own, the same one the platform console already used;
 * this is that primitive promoted to both shells rather than the operator half of it staying a
 * bespoke `localStorage` implementation beside it.
 *
 * `bottomBar` is a phone-only sibling of `SidebarInset`, inside `SidebarProvider` so its Menu control can open the
 * sidebar's own mobile Sheet (`useSidebar`). The sheet is the phone's navigation; the header offers no
 * sidebar trigger below `md`, and the page keeps `--mobile-nav-height` clear beneath it.
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
    <SidebarProvider className="h-svh overflow-hidden">
      {/* `sidebar`, `header` and `bottomBar` are elements the calling layout created on the server. When
          the payload is large enough to stream in more than one piece they arrive as lazy siblings, which
          trips React's dev key check exactly as `agent` does in `WorkspaceShell`; a keyed wrapper is the
          same answer, and changes nothing that renders. */}
      <Fragment key="sidebar">{sidebar}</Fragment>
      {/* `h-svh overflow-hidden` above fixes the wrapper to the viewport, so a page that opts into
          filling it (a flex column down to `flex-1 min-h-0`, as Schedule does) gets a real
          available height to fill rather than an auto-growing one. Every other page is
          unaffected: `min-h-0 overflow-y-auto` below just moves its scrollbar from the document
          to this `main`, which looks identical. */}
      <SidebarInset className="min-h-0 overflow-y-auto">
        <Fragment key="header">{header}</Fragment>
        {/* Beneath the workspace header, beside the page: the page drawer lives here, so it starts
            under the header and the page stays visible next to it. */}
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className={cx('flex min-h-0 min-w-0 flex-1 flex-col', PAGE_PADDING, bottomBar ? 'pb-[calc(var(--mobile-nav-height,0px)+1.5rem)] md:pb-6' : undefined)}>
            {children}
          </div>
          <PagePanel />
        </div>
      </SidebarInset>
      <Fragment key="bottom-bar">{bottomBar}</Fragment>
    </SidebarProvider>
  );
}
