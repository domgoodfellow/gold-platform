'use client';

import { Fragment, useEffect, type ReactNode } from 'react';
import { SidebarInset, SidebarProvider, useSidebar } from '@gold/ui/components/sidebar';
import { usePathname } from 'next/navigation';
import { cx } from '../class-names';
import { PAGE_BOTTOM_CLEARANCE, PAGE_BOTTOM_CLEARANCE_WITH_NAV, PAGE_PADDING } from './workspace-geometry';
import { PagePanel } from '../panels/workspace-right-rail';
import { useShellLayout } from './shell-layout-context';

/** Choosing a destination closes the phone sheet and a tablet overlay; neither is meant to stay open. */
function MobileNavigationDismissal({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { setOpenMobile, closeOverlay } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
    closeOverlay();
  }, [pathname, setOpenMobile, closeOverlay]);
  return <div className="contents" onClickCapture={(event) => {
    if (!(event.target as Element).closest('a[href]')) return;
    setOpenMobile(false);
    closeOverlay();
  }}>{children}</div>;
}

/**
 * The two-column frame every shell renders inside: a `Sidebar` the caller builds (each shell
 * owns its own navigation) and a scrolling main slot. State — open/collapsed, icon rail,
 * mobile sheet — is `SidebarProvider`'s own, the same one the platform console already used;
 * this is that primitive promoted to both shells rather than the operator half of it staying a
 * bespoke `localStorage` implementation beside it.
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
  const layout = useShellLayout();
  return (
    <SidebarProvider className="h-svh overflow-hidden" defaultOpen={layout.open} defaultViewport={layout.viewport}>
      <MobileNavigationDismissal>
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
            {/* This column is `min-h-0` so a page can fill it, which also means a long page overflows it
                instead of growing it — and a flex container's own bottom padding is not part of that
                overflow, so the last control sat flush against the scroll edge. The clearance is a real
                trailing child instead, which is always part of what scrolls. */}
            <div className={cx('flex min-h-0 min-w-0 flex-1 flex-col', PAGE_PADDING, 'pb-0 sm:pb-0 lg:pb-0')}>
              {children}
              <div aria-hidden className={cx('shrink-0', PAGE_BOTTOM_CLEARANCE, bottomBar ? PAGE_BOTTOM_CLEARANCE_WITH_NAV : undefined)} />
            </div>
            <PagePanel />
          </div>
        </SidebarInset>
        <Fragment key="bottom-bar">{bottomBar}</Fragment>
      </MobileNavigationDismissal>
    </SidebarProvider>
  );
}
