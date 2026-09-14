'use client';

import { AccountMenu } from '@/components/containers/account-menu';
import { ContextSwitcher, GOLD_MARK, type SwitchableOrganization } from '@/components/containers/context-switcher';
import { Hint } from '@/components/controls/inputs';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@gold/ui/components/sidebar';

/**
 * Account's own sidebar — the same `ContextSwitcher`/`AccountMenu` pair every shell's sidebar
 * carries, with no navigation list of its own: Account is one page, not a set of areas to move
 * between. `ContextSwitcher` is still how a caller here reaches a business or Platform
 * Administration — the same "where am I operating" control, never duplicated.
 */
export function AccountSidebar({
  email,
  signOutAction,
  businesses,
  platformStaff,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  email: string;
  signOutAction: () => Promise<void>;
  businesses: SwitchableOrganization[];
  platformStaff: boolean;
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <ContextSwitcher
          mark={GOLD_MARK}
          current={{ kind: 'account' }}
          organizations={businesses}
          platformStaff={platformStaff}
        />
      </SidebarHeader>
      <SidebarContent className="p-3 group-data-[collapsible=icon]:hidden">
        <Hint>Personal — not owned by any business or Platform Administration.</Hint>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <AccountMenu email={email} signOutAction={signOutAction} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
