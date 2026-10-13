'use client';

import Link from 'next/link';
import { useContext } from 'react';
import { NavigationActivityContext } from './activity-context';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, LifeBuoy, Settings } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@gold/ui/components/sidebar';
import type { PlatformContext } from './context-switcher';
import { settingsLandingHref } from '@/lib/route/settings';
import { organizationIdFromPath } from '@/lib/route/platform-context';
import { inSettingsContext } from '@/lib/settings-nav';

/** Receives only server-resolved Platform authority; links never grant it. */
export function SidebarFooterNavigation({ organizationId, platform, locked = false }: {
  organizationId?: string;
  platform?: PlatformContext | null;
  locked?: boolean;
}) {
  const pathname = usePathname();
  const preserveActivity = useContext(NavigationActivityContext);
  const from = organizationId ?? organizationIdFromPath(pathname);
  const { setOpenMobile } = useSidebar();
  const items = [
    ...(platform ? [{ label: 'Platform', href: platform.href, Icon: LayoutDashboard, active: pathname === platform.href || pathname.startsWith(`${platform.href}/`) }] : []),
    ...(from ? [{ label: 'Help & Support', href: `/organizations/${from}/help`, Icon: LifeBuoy, active: pathname.startsWith(`/organizations/${from}/help`) }] : []),
    { label: 'Settings', href: locked && from ? `/organizations/${from}/settings/plan` : settingsLandingHref(from), Icon: Settings, active: from ? inSettingsContext(pathname, from) : pathname.startsWith('/settings/account') },
  ];
  return <nav aria-label="Application controls"><SidebarMenu>
    {items.map(({ label, href, Icon, active }) => <SidebarMenuItem key={label}>
      <SidebarMenuButton asChild tooltip={label} isActive={active}>
        <Link href={href} target={label === 'Platform' && preserveActivity && organizationIdFromPath(href) !== from ? '_blank' : undefined} rel={label === 'Platform' && preserveActivity ? 'noopener noreferrer' : undefined} aria-label={label} aria-current={active ? 'page' : undefined} onClick={() => setOpenMobile(false)}><Icon aria-hidden /><span>{label}</span></Link>
      </SidebarMenuButton>
    </SidebarMenuItem>)}
  </SidebarMenu></nav>;
}
