'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, ShieldCheck, UserRound } from 'lucide-react';
import { AccountMenu } from '@/components/containers/account-menu';
import { ContextSwitcher, GOLD_MARK, type SwitchableOrganization } from '@/components/containers/context-switcher';
import { PERSONAL_SECTIONS, personalSettingsHref, type PersonalSection } from '@/lib/route/personal-settings';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@gold/ui/components/sidebar';

/** Presentation only, keyed by section like `AREA_ICONS`: the collapsed sidebar shows nothing but these. */
const SECTION_ICONS: Record<PersonalSection, typeof UserRound> = {
  profile: UserRound,
  security: ShieldCheck,
};

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
  back,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  email: string;
  signOutAction: () => Promise<void>;
  businesses: SwitchableOrganization[];
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
        {/* No group label: the switcher above already says "Personal settings", once. */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {PERSONAL_SECTIONS.map((section) => {
                const Icon = SECTION_ICONS[section.key];
                return (
                  <SidebarMenuItem key={section.key}>
                    <SidebarMenuButton asChild isActive={pathname === section.path} tooltip={section.label}>
                      <Link href={personalSettingsHref(section.key, back?.organizationId)}>
                        <Icon aria-hidden />
                        <span>{section.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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
