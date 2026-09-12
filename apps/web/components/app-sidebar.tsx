'use client';

import Link from 'next/link';
import { AccountMenu } from '@/components/containers/account-menu';
import { PlatformNavigation } from '@/features/platform/platform-navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@gold/ui/components/sidebar';

export function AppSidebar({
  email,
  signOutAction,
  ...props
}: React.ComponentProps<typeof Sidebar> & { email: string; signOutAction: () => Promise<void> }) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="GOLD">
              <Link href="/platform">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">G</span>
                <span className="text-base font-semibold">GOLD</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent><PlatformNavigation /></SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><AccountMenu email={email} signOutAction={signOutAction} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
