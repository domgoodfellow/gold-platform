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
import { Button } from '@/components/controls/button';
import { cx } from '@/components/class-names';
import { organizationIdFromPath } from '@/lib/route/platform-context';
import { settingsScopeHref } from '@/lib/route/settings';

/**
 * The truthful, shared person/session menu, one implementation for every shell's sidebar footer.
 * Represents the PERSON, not where they are operating — cross-context navigation (switching
 * business, entering Platform Administration) is `ContextSwitcher`'s job alone. Settings is one
 * destination (Organization, Account, Access, Connections and Subscription are scopes inside it,
 * `SettingsScopeNav`), so this menu offers exactly one Settings entry rather than a Business/Account
 * split — landing on Organization when a business is offered, on Account otherwise.
 */

type AccountMenuProps = {
  /** The signed-in Supabase Auth email. Every caller resolves it the same way: `db.auth.getUser()`. */
  email: string;
  signOutAction: () => Promise<void>;
  /** Whether the current organization has anything this member may configure — `lib/shell.ts`'s
   * `businessSettingsOffered`. Absent or `false` sends the one Settings entry to Account instead
   * of Organization, rather than opening a scope with nothing behind it. */
  businessSettingsOffered?: boolean;
};

function AccountMenuContent({ email, signOutAction, businessSettingsOffered }: AccountMenuProps) {
  // The business being left, so Settings can land on its Organization scope and Subscription can
  // offer a shortcut. Read from the path rather than passed in: this menu is shared by shells that
  // have no organization at all.
  const from = organizationIdFromPath(usePathname());
  const settingsHref = from && businessSettingsOffered
    ? settingsScopeHref('organization', from)
    : settingsScopeHref('account', from);

  return (
    <>
      <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><Link href={settingsHref}><Settings />Settings</Link></DropdownMenuItem>
      {from ? (
        <DropdownMenuItem asChild>
          <Link href={settingsScopeHref('subscription', from)}><CreditCard />Subscription</Link>
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
export function AccountMenu({ email, signOutAction, businessSettingsOffered }: AccountMenuProps) {
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
            side={side}
            align={side === 'top' ? 'center' : 'end'}
            sideOffset={8}
            className={cx('min-w-56', side === 'top' && 'w-(--radix-dropdown-menu-trigger-width)')}
          >
            <AccountMenuContent email={email} signOutAction={signOutAction} businessSettingsOffered={businessSettingsOffered} />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * The same menu, behind a trigger sized for a phone header rather than a `Sidebar` row.
 * Deliberately not built from `SidebarMenuButton` — that control is `w-full` by design (correct
 * inside a `Sidebar`'s own fixed-width column), and stretching it into a header's flex row would
 * fight the other controls in it for space rather than sizing to its own content, exactly the
 * geometry `WorkspaceHeader`'s row depends on getting right around it.
 */
export function CompactAccountMenu({ email, signOutAction, businessSettingsOffered }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          size="small"
          aria-label={`Account — signed in as ${email}`}
          className="px-2"
        >
          <Avatar className="size-5 rounded-full">
            <AvatarFallback className="rounded-full text-[10px]">
              {email.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" sideOffset={8} className="min-w-56">
        <AccountMenuContent email={email} signOutAction={signOutAction} businessSettingsOffered={businessSettingsOffered} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
