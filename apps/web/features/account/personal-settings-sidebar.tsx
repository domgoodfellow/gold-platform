'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AccountMenu } from '@/components/containers/account-menu';
import { ContextSwitcher, GOLD_MARK, type SwitchableOrganization } from '@/components/containers/context-switcher';
import { PERSONAL_SECTIONS, personalSettingsHref } from '@/lib/route/personal-settings';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@gold/ui/components/sidebar';

/**
 * Personal settings' own sidebar: the same header/footer pair every shell carries, and a list of
 * *personal* sections only — nothing organization-owned is listed to fill it. `ContextSwitcher`
 * stays the one way into a business; `back` is the business the person came from, when there was
 * one, so leaving Personal settings returns them rather than dropping them at the list.
 */
export function PersonalSettingsSidebar({
  email,
  signOutAction,
  businesses,
  platformAdministration,
  back,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  email: string;
  signOutAction: () => Promise<void>;
  businesses: SwitchableOrganization[];
  platformAdministration: boolean;
  back: { organizationId: string; name: string; href: string } | null;
}) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <ContextSwitcher
          mark={GOLD_MARK}
          current={{ kind: 'account' }}
          organizations={businesses}
          platformAdministration={platformAdministration}
        />
      </SidebarHeader>
      <SidebarContent>
        {back ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={`Back to ${back.name}`}>
                    <Link href={back.href}>
                      <ArrowLeft aria-hidden />
                      <span>Back to {back.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
        <SidebarGroup>
          <SidebarGroupLabel>Personal settings</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PERSONAL_SECTIONS.map((section) => (
                <SidebarMenuItem key={section.key}>
                  <SidebarMenuButton asChild isActive={pathname === section.path} tooltip={section.label}>
                    <Link href={personalSettingsHref(section.key, back?.organizationId)}>
                      <span>{section.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <AccountMenu email={email} signOutAction={signOutAction} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
