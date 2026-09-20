'use client';

import { AccountMenu } from '@/components/containers/account-menu';
import { ContextSwitcher, GOLD_MARK, type SwitchableOrganization } from '@/components/containers/context-switcher';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from '@gold/ui/components/sidebar';

/**
 * The sidebar of the fallback frame: the context switcher and the account menu, and nothing in
 * between. No area list, because there is no organization to list areas of; the switcher is how a
 * person picks somewhere real to go.
 */
export function GlobalFallbackSidebar({
  email,
  signOutAction,
  businesses,
  platformAdministration,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  email: string;
  signOutAction: () => Promise<void>;
  businesses: SwitchableOrganization[];
  platformAdministration: boolean;
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <ContextSwitcher
          mark={GOLD_MARK}
          current={{ kind: 'global' }}
          organizations={businesses}
          platformAdministration={platformAdministration}
        />
      </SidebarHeader>
      <SidebarContent />
      <SidebarFooter className="border-t border-sidebar-border">
        <AccountMenu email={email} signOutAction={signOutAction} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
