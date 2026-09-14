'use client';

import { WorkspaceHeader } from '@/components/containers/workspace-header';

/**
 * Platform Context's own header content around the shared `WorkspaceHeader` geometry. Every
 * Platform page registers its own title and breadcrumb ancestry
 * (`useWorkspacePageChrome`/`PageChromeRegistrar`, `workspace-page-chrome.tsx`) — the header no
 * longer guesses a title from the pathname (the former `TITLES` prefix table, which had gone out
 * of sync with the route tree, and `platform-header-title.tsx`'s one-off override store, both
 * retired by this correction). `primary` here is only the brief fallback shown before a page's
 * chrome registers.
 */
export function PlatformHeader() {
  return (
    <WorkspaceHeader
      navigationTrigger="always"
      primary={<span className="text-sm font-semibold text-muted-foreground">Platform</span>}
    />
  );
}
