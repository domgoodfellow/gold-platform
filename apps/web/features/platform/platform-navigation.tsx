'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, CircleDollarSign, CreditCard, Gauge, LayoutDashboard, Landmark, Blocks, Package, Plug, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@gold/ui/components/sidebar';
import { AccountMenu } from '@/components/containers/account-menu';
import { cx, FOCUS_RING } from '@/components/class-names';
import {
  ContextSwitcher,
  type SwitchableOrganization,
  type SwitcherContext,
} from '@/components/containers/context-switcher';

export const PLATFORM_NAV = [
  { label: 'Overview', href: '/platform', icon: LayoutDashboard, group: 'Platform' },
  { label: 'Organizations', href: '/platform/organizations', icon: Building2, group: 'Customers' },
  { label: 'Catalog', href: '/platform/catalog', icon: Package, group: 'Catalog' },
  { label: 'Plans & Add-ons', href: '/platform/catalog/plans', icon: Landmark, group: 'Catalog' },
  { label: 'Meters', href: '/platform/catalog/meters', icon: Gauge, group: 'Catalog' },
  { label: 'Integrations', href: '/platform/integrations', icon: Blocks, group: 'Catalog' },
  { label: 'Pricing', href: '/platform/pricing', icon: CircleDollarSign, group: 'Revenue' },
  { label: 'Billing', href: '/platform/billing', icon: CreditCard, group: 'Revenue' },
  { label: 'Providers', href: '/platform/providers', icon: Plug, group: 'Infrastructure' },
  { label: 'Failures', href: '/platform/failures', icon: TriangleAlert, group: 'Infrastructure' },
] as const;

const PLATFORM_GROUPS = ['Platform', 'Customers', 'Catalog', 'Revenue', 'Infrastructure'] as const;

function isPrefix(href: string, pathname: string) {
  if (href === '/platform') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Longest matching href wins, so a nested detail route (a Plan, a Product family, a legacy line
 * item) highlights the nav item that actually owns it rather than every ancestor prefix at once —
 * `/platform/catalog/plans/{key}` matches both `/platform/catalog` and `/platform/catalog/plans`;
 * only the second, more specific one is "active".
 */
function activeHref(pathname: string): string | undefined {
  const matches = PLATFORM_NAV.filter((item) => isPrefix(item.href, pathname));
  if (matches.length === 0) return undefined;
  return matches.reduce((best, item) => (item.href.length > best.href.length ? item : best)).href;
}

export function PlatformNavigation() {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <nav aria-label="Platform">
      {PLATFORM_GROUPS.map((group) => (
        <SidebarGroup key={group}>
          <SidebarGroupLabel>{group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PLATFORM_NAV.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const isActive = item.href === active;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
                      <Link href={item.href} aria-current={isActive ? 'page' : undefined}>
                        <Icon aria-hidden />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}

/**
 * The whole Platform Administration sidebar. It is its own context, not a section of GOLD's
 * business navigation: the switcher in its header is how somebody returns to GOLD or any other
 * business they belong to, and nothing here reads `AREAS`. `current` is the GOLD Internal
 * membership `/platform` renders inside; the switcher derives Platform from the path.
 */
export function PlatformSidebar({
  mark,
  current,
  organizations,
  email,
  signOutAction,
  ...props
}: {
  mark: ReactNode;
  current: Extract<SwitcherContext, { kind: 'business' }>;
  organizations: SwitchableOrganization[];
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <ContextSwitcher mark={mark} current={current} organizations={organizations} platformAdministration />
      </SidebarHeader>
      <SidebarContent>
        <PlatformNavigation />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <AccountMenu email={email} signOutAction={signOutAction} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** The phone rendering of `PLATFORM_NAV`: the same registry, a scrolling bottom bar, no drawer. */
export function PlatformNavBar() {
  const active = activeHref(usePathname());

  return (
    <nav
      aria-label="Platform Administration"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background md:hidden"
    >
      <ul className="flex gap-1 overflow-x-auto p-2">
        {PLATFORM_NAV.map((item) => {
          const Icon = item.icon;
          const current = item.href === active;
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={cx(
                  FOCUS_RING,
                  'flex items-center justify-center gap-2 rounded px-3 py-1.5 text-sm',
                  current ? 'bg-foreground font-medium text-background' : 'hover:bg-hover',
                )}
              >
                <Icon aria-hidden size={18} className="shrink-0" />
                <span className="min-w-0">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
