'use client';

import Link from 'next/link';
import { Building2, ChevronUp, LogOut, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@gold/ui/components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@gold/ui/components/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@gold/ui/components/sidebar';

/**
 * The truthful, shared person/session menu, one implementation for every shell's sidebar
 * footer. It used to exist twice — this version, hand-rolled around `useSidebarCollapsed`, and
 * `PlatformAccountMenu` in `app-sidebar.tsx`, built the same afternoon against the platform
 * console's own `Sidebar` and already tooltip-aware for free. Now that both shells sit inside
 * the same `SidebarProvider`, there is one menu rather than two only ever a few lines apart.
 */
export function AccountMenu({
  email,
  signOutAction,
}: {
  /** The signed-in Supabase Auth email. Every caller resolves it the same way: `db.auth.getUser()`. */
  email: string;
  signOutAction: () => Promise<void>;
}) {
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={email}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg">
                  {email.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{email}</span>
                <span className="truncate text-xs text-sidebar-foreground/70">Signed in</span>
              </div>
              <ChevronUp aria-hidden className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={8}
            className="min-w-56"
          >
            <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/account"><UserRound />Account</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/organizations?all=1"><Building2 />Your businesses</Link></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => { void signOutAction(); }}><LogOut />Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
