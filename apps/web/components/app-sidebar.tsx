'use client';

import { AccountMenu } from '@/components/containers/account-menu';
import { ContextSwitcher, GOLD_MARK, type SwitchableOrganization } from '@/components/containers/context-switcher';
import { PlatformNavigation } from '@/features/platform/platform-navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@gold/ui/components/sidebar';

export function AppSidebar({
  email,
  signOutAction,
  businesses,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  email: string;
  signOutAction: () => Promise<void>;
  /** Every business this identity belongs to, exactly as `listMyOrganizations` returned it — the
   * platform shell renders the same context switcher the organization shell does, so that a
   * caller holding both Platform authority and one or more memberships (D45) never has to leave
   * the header to move between them (`ui-spec.md` §1). Platform's own navigation is unchanged. */
  businesses: SwitchableOrganization[];
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <ContextSwitcher
          mark={GOLD_MARK}
          current={{ kind: 'platform' }}
          organizations={businesses}
          platformStaff
        />
      </SidebarHeader>
      <SidebarContent><PlatformNavigation /></SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><AccountMenu email={email} signOutAction={signOutAction} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
