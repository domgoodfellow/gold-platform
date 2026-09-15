'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, CircleDollarSign, CreditCard, Gauge, LayoutDashboard, Landmark, Package, Plug, TriangleAlert } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@gold/ui/components/sidebar';

export const PLATFORM_NAV = [
  { label: 'Overview', href: '/platform', icon: LayoutDashboard, group: 'Platform' },
  { label: 'Organizations', href: '/platform/organizations', icon: Building2, group: 'Customers' },
  { label: 'Catalog', href: '/platform/catalog', icon: Package, group: 'Catalog' },
  { label: 'Plans & Add-ons', href: '/platform/catalog/plans', icon: Landmark, group: 'Catalog' },
  { label: 'Meters', href: '/platform/catalog/meters', icon: Gauge, group: 'Catalog' },
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
