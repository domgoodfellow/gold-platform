'use client';

import { ChevronRight, ChevronUp, LogOut } from 'lucide-react';
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
import { cx } from '@/components/class-names';

/** The shared person/session menu. Application destinations live in the sidebar footer. */
type AccountMenuProps = {
  /** The signed-in Supabase Auth email. Every caller resolves it the same way: `db.auth.getUser()`. */
  email: string;
  signOutAction: () => Promise<void>;
};

function AccountMenuContent({ email, signOutAction }: AccountMenuProps) {
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-3 font-normal">
        <Avatar className="size-8 rounded-lg">
          <AvatarFallback className="rounded-lg">{email.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="grid min-w-0 flex-1 text-sm leading-tight">
          <span className="truncate font-medium">Signed in</span>
          <span className="truncate text-xs text-muted-foreground">{email}</span>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => { void signOutAction(); }}><LogOut />Sign out</DropdownMenuItem>
    </>
  );
}

/**
 * The `Sidebar`-footer trigger, for use inside a desktop/tablet sidebar. Collapsed, the menu opens
 * to the right, beside the icon rail; expanded, it opens above its own trigger, attached to the
 * footer it sits in, rather than floating off to the side of a full-width row.
 */
export function AccountMenu({ email, signOutAction }: AccountMenuProps) {
  const { isMobile, state } = useSidebar();
  const side = isMobile ? 'bottom' : state === 'collapsed' ? 'right' : 'top';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={email}
              className="group/account-menu border-t border-sidebar-border data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
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
              {/* Points the way the menu opens, and turns over while it is open. */}
              {side === 'right' ? (
                <ChevronRight aria-hidden className="ml-auto size-4" />
              ) : (
                <ChevronUp aria-hidden className={cx('ml-auto size-4 transition-transform', side === 'bottom' ? 'rotate-180 group-data-[state=open]/account-menu:rotate-0' : 'group-data-[state=open]/account-menu:rotate-180')} />
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={side}
            align={side === 'top' ? 'center' : 'end'}
            sideOffset={8}
            className={cx('min-w-56', side === 'top' && 'w-(--radix-dropdown-menu-trigger-width)')}
          >
            <AccountMenuContent email={email} signOutAction={signOutAction} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
