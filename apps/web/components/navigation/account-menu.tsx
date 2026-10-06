'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronUp, CreditCard, LogOut, Settings } from 'lucide-react';
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
import { organizationIdFromPath } from '@/lib/route/platform-context';
import { settingsLandingHref, settingsScopeHref } from '@/lib/route/settings';

/**
 * The truthful, shared person/session menu, one implementation for every shell's sidebar footer.
 * Represents the PERSON, not where they are operating — cross-context navigation (switching
 * business, entering Platform Administration) is `ContextSwitcher`'s job alone. Settings is one
 * landing page with five destinations chosen from it (Organization, Account, Access, Connections
 * and Plan & usage), so this menu offers exactly one Settings entry rather than a Business/Account
 * split. Settings opens the canonical Settings landing page when an organization is in context,
 * and Account when there is no organization context.
 */

type AccountMenuProps = {
  /** The signed-in Supabase Auth email. Every caller resolves it the same way: `db.auth.getUser()`. */
  email: string;
  signOutAction: () => Promise<void>;
};

function AccountMenuContent({ email, signOutAction }: AccountMenuProps) {
  // The business being left, so Settings can open its canonical landing page and Plan & usage can
  // offer a shortcut. Read from the path rather than passed in: this menu is shared by shells that
  // have no organization at all.
  const from = organizationIdFromPath(usePathname());
  const settingsHref = settingsLandingHref(from);

  return (
    <>
      <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><Link href={settingsHref}><Settings />Settings</Link></DropdownMenuItem>
      {from ? (
        <DropdownMenuItem asChild>
          <Link href={settingsScopeHref('plan', from)}><CreditCard />Plan &amp; usage</Link>
        </DropdownMenuItem>
      ) : null}
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
              className="group/account-menu data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
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
              <ChevronUp aria-hidden className="ml-auto size-4 transition-transform group-data-[state=open]/account-menu:rotate-180" />
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
