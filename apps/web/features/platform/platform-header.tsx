'use client';

import { usePathname } from 'next/navigation';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { usePlatformHeaderOverride } from '@/features/platform/platform-header-title';

const TITLES: Array<[prefix: string, title: string]> = [
  ['/platform/organizations', 'Organizations'],
  ['/platform/catalog/products', 'Products'],
  ['/platform/catalog/modules', 'Modules'],
  ['/platform/catalog/meters', 'Meters'],
  ['/platform/pricing', 'Pricing'],
  ['/platform/providers', 'Providers'],
  ['/platform/failures', 'Failures'],
];

function titleFor(pathname: string) {
  if (pathname === '/platform') return 'Overview';
  return TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Platform';
}

/**
 * Platform Context's own header content — pathname → title resolution and
 * `usePlatformHeaderOverride` — around the shared `WorkspaceHeader` geometry. Replaces the
 * Platform-only `SiteHeader`, which mixed this title logic into the same file as the sticky
 * header markup Business Context was separately hand-writing (`organizations/[organizationId]/
 * layout.tsx`); `WorkspaceHeader` is now the one place either geometry lives.
 */
export function PlatformHeader() {
  const pathname = usePathname();
  const override = usePlatformHeaderOverride();

  return (
    <WorkspaceHeader
      navigationTrigger="always"
      primary={
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">
          {override ?? titleFor(pathname)}
        </h1>
      }
    />
  );
}
