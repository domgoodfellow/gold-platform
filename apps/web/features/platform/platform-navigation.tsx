'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, CircleDollarSign, Gauge, LayoutDashboard, Landmark, Package, Plug, TriangleAlert } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

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

export function PlatformNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Platform">
      {PLATFORM_GROUPS.map((group) => (
        <SidebarGroup key={group}>
          <SidebarGroupLabel>{group}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PLATFORM_NAV.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const active = isActive(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href} aria-current={active ? 'page' : undefined}>
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
