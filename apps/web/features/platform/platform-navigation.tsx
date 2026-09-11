'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, CircleDollarSign, Gauge, LayoutDashboard, Landmark, Package, Plug, TriangleAlert } from 'lucide-react';
import { cx, FOCUS_RING } from '@/components/class-names';
import { SidebarLabel, useSidebarCollapsed } from '@/components/containers/app-shell';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export const PLATFORM_NAV = [
  { label: 'Overview', href: '/platform', icon: LayoutDashboard, group: 'Platform' },
  { label: 'Organizations', href: '/platform/organizations', icon: Building2, group: 'Customers' },
  { label: 'Products', href: '/platform/catalog/products', icon: Package, group: 'Catalog' },
  { label: 'Modules', href: '/platform/catalog/modules', icon: Landmark, group: 'Catalog' },
  { label: 'Meters', href: '/platform/catalog/meters', icon: Gauge, group: 'Catalog' },
  { label: 'Pricing', href: '/platform/pricing', icon: CircleDollarSign, group: 'Revenue' },
  { label: 'Providers', href: '/platform/providers', icon: Plug, group: 'Infrastructure' },
  { label: 'Failures', href: '/platform/failures', icon: TriangleAlert, group: 'Infrastructure' },
] as const;

const PLATFORM_GROUPS = ['Platform', 'Customers', 'Catalog', 'Revenue', 'Infrastructure'] as const;

function isActive(pathname: string, href: string) {
  if (href === '/platform') return pathname === href;
  return href === '/platform/organizations' ? pathname.startsWith(href) : pathname === href;
}

export function PlatformNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();

  return (
    <nav aria-label="Platform" className="flex-1 overflow-y-auto p-2">
      {PLATFORM_GROUPS.map((group) => (
        <div key={group}>
          <p className={cx('mt-4 px-3 text-xs font-medium uppercase tracking-wider text-subtle', !mobile && 'md:hidden lg:block', collapsed && 'lg:hidden')}>{group}</p>
          {PLATFORM_NAV.filter((item) => item.group === group).map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href);
            const link = (
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  FOCUS_RING,
                  'mt-1 flex h-10 items-center gap-3 rounded-md px-3 text-sm',
                  !mobile && (collapsed ? 'justify-center px-0' : 'md:justify-center lg:justify-start'),
                  active ? 'bg-foreground font-medium text-background' : 'text-muted hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
                )}
              >
                <Icon aria-hidden size={18} className="shrink-0" />
                {mobile ? <span>{item.label}</span> : <SidebarLabel>{item.label}</SidebarLabel>}
              </Link>
            );
            return mobile ? <div key={item.href}>{link}</div> : (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" className={cx(!collapsed && 'lg:hidden')}>{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
