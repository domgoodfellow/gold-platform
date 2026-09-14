'use client';

import { usePathname } from 'next/navigation';
import { Separator } from '@gold/ui/components/separator';
import { SidebarTrigger } from '@gold/ui/components/sidebar';
import { usePlatformHeaderOverride } from '@/features/platform/platform-header-title';
import { WorkspaceHeaderActions } from '@/components/containers/workspace-right-rail';

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

export function SiteHeader() {
  const pathname = usePathname();
  const override = usePlatformHeaderOverride();

  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center border-b border-border bg-background">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">{override ?? titleFor(pathname)}</h1>
        <WorkspaceHeaderActions />
      </div>
    </header>
  );
}
