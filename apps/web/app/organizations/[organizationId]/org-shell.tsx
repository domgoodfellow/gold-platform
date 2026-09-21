'use client';

import { AccountMenu } from '@/components/containers/account-menu';
import { ContextSwitcher, type SwitchableOrganization } from '@/components/containers/context-switcher';
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
import { MoreMenu } from '@/components/containers/more-menu';
import { cx, FOCUS_RING } from '@/components/class-names';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  BarChart3,
  Blocks,
  Building2,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Gauge,
  Home,
  Landmark,
  Layers,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Package,
  Phone,
  Plug,
  Settings,
  TriangleAlert,
  UserCog,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { areaHref, currentSegment } from '@/lib/navigation';
import { activeItemKey, projectPhone, type NavItem, type ShellSection } from '@/lib/shell';

/**
 * The shell's renderers. They decide nothing: every item they draw comes from one projection
 * (`projectShell`), which the layout resolves once from the organization's entitlements, the
 * member's permissions and — in GOLD's own organization only — their platform authority, and hands
 * to the desktop sidebar, the collapsed rail and the phone bar alike. There is no eligibility rule
 * here, so a breakpoint cannot disagree with another about what a person may reach.
 */

/**
 * One icon per area, keyed by segment rather than declared on `Area` itself — icon choice is how
 * the shell draws the IA, not part of what the IA is (`navigation.ts` stays segments, labels,
 * groups, modules). `navigation.test.ts` asserts every sidebar `AREAS` entry has one here, so a new
 * area without an icon fails at the gate rather than rendering blank in the rail.
 */
export const AREA_ICONS: Record<string, LucideIcon> = {
  home: Home,
  work: ClipboardList,
  schedule: CalendarDays,
  customers: Users,
  calls: Phone,
  locations: MapPin,
  assets: Package,
  resources: Layers,
  insights: BarChart3,
  automations: Zap,
  setup: ListChecks,
  settings: Settings,
};

/** Every item the projection can produce: the areas, the administration items, and the platform destinations. */
export const NAV_ICONS: Record<string, LucideIcon> = {
  ...AREA_ICONS,
  team: UserCog,
  connections: Plug,
  plan: CreditCard,
  'platform-overview': LayoutDashboard,
  'platform-organizations': Building2,
  'platform-catalog': Package,
  'platform-plans': Landmark,
  'platform-meters': Gauge,
  'platform-connectors': Blocks,
  'platform-pricing': CircleDollarSign,
  'platform-billing': CreditCard,
  'platform-providers': Plug,
  'platform-failures': TriangleAlert,
};

/**
 * The tablet and desktop rendering: `Sidebar`'s own grouped-menu vocabulary, one `SidebarGroup` per
 * projected section in order — Home, the workspaces, Operations, Administration, and (only inside
 * GOLD, only with platform authority) Platform. Collapse-to-icon, the tooltip that appears while
 * collapsed, and the `md`-and-up-only rendering are all `Sidebar`'s own, not reimplemented here.
 */
export function OrgNav({ sections }: { sections: ShellSection[] }) {
  const active = activeItemKey(sections, usePathname());

  return (
    <nav aria-label="This business">
      {sections.map((section) => (
        <SidebarGroup key={section.key}>
          {section.label ? <SidebarGroupLabel>{section.label}</SidebarGroupLabel> : null}
          <SidebarGroupContent>
            <SidebarMenu>
              {section.items.map((item) => {
                const Icon = NAV_ICONS[item.key];
                const current = item.key === active;
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton asChild isActive={current} tooltip={item.label}>
                      <Link href={item.href} aria-current={current ? 'page' : undefined}>
                        {Icon ? <Icon aria-hidden /> : null}
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}

export type { SwitchableOrganization };

const PHONE_ROW = 'flex items-center justify-center gap-2 rounded px-3 py-1.5 text-sm';

/** A single row in the phone bar — plain Tailwind, not `Sidebar`'s vocabulary, since this list never collapses and never sits inside a `Sidebar` at all (see `OrgNavBar`). */
function PhoneNavLink({ item, current }: { item: NavItem; current: boolean }) {
  const Icon = NAV_ICONS[item.key];

  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
      className={cx(FOCUS_RING, PHONE_ROW, current ? 'bg-foreground font-medium text-background' : 'hover:bg-hover')}
    >
      {Icon ? <Icon aria-hidden size={18} className="shrink-0" /> : null}
      <span className="min-w-0">{item.label}</span>
    </Link>
  );
}

/**
 * The phone rendering of the same projection: a fixed bar with Home, the first workspaces and one
 * **More** button, which opens everything else — the remaining workspaces, Operations,
 * Administration and Platform — in a sheet, grouped exactly as the desktop sidebar groups them.
 * Frequent work is one thumb away; the less frequent is understandable and never crowds it, however
 * many sections a member's authority produces. It is a rendering choice over `projectPhone`, not a
 * second eligibility rule.
 *
 * It lists this business's places and nothing else. Platform items appear here only where the
 * projection produced them — GOLD's own organization, for an operator holding the permission —
 * behind More, never in the bar.
 *
 * It renders outside `Sidebar` entirely, never inside it: shadcn's own mobile rendering below `md`
 * is an off-canvas sheet no trigger reaches, so it mounts closed and this bar is what a phone
 * actually sees. When the current page belongs to something behind More, More is the current item.
 */
export function OrgNavBar({
  organizationId,
  sections,
  setup = false,
}: {
  organizationId: string;
  sections: ShellSection[];
  /** True only while the business is in SETUP — the layout decides, and it leaves the bar the moment the business is LIVE. */
  setup?: boolean;
}) {
  const active = activeItemKey(sections, usePathname());
  const { primary, more } = projectPhone(sections);

  return (
    <nav
      aria-label="This business"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background md:hidden"
    >
      <ul className="flex gap-1 overflow-x-auto p-2">
        {setup ? (
          <li className="shrink-0">
            <SetupNavLink organizationId={organizationId} />
          </li>
        ) : null}
        {primary.map((item) => (
          <li key={item.key} className="shrink-0">
            <PhoneNavLink item={item} current={item.key === active} />
          </li>
        ))}
        {more.length > 0 ? (
          <li className="shrink-0">
            <MoreMenu
              sections={more}
              activeKey={active}
              triggerClassName={PHONE_ROW}
              renderIcon={(key) => {
                const Icon = NAV_ICONS[key];
                return Icon ? <Icon aria-hidden size={18} className="shrink-0" /> : null;
              }}
            />
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

/**
 * The one Setup treatment while a business is in SETUP — an ordinary navigation row above the
 * areas, and the only setup affordance the shell draws: not a second call to action, not a badge,
 * not a count. Setup owns progress (`SetupProgressCard`); navigation only goes there, so the
 * shell runs no readiness query on every request. The layout renders it only while
 * `operationalState === 'setup'`, so it is gone the moment the business is LIVE with nothing left
 * to remember to turn off. Same collapse-to-icon and tooltip behaviour as every other row.
 */
export function SetupEntry({ organizationId }: { organizationId: string }) {
  const current = currentSegment(usePathname()) === 'setup';

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={current}
            tooltip="Setup"
          >
            <Link href={areaHref(organizationId, 'setup')} aria-current={current ? 'page' : undefined}>
              <ListChecks aria-hidden />
              <span>Setup</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/**
 * The phone's rendering of the same lifecycle treatment: the first item in the bottom bar, only
 * while the business is in SETUP. It is the bar's own row, not a header badge, and `ui-spec.md` §2's
 * rule against a permanent extra bottom-bar destination holds because it disappears at Launch.
 */
export function SetupNavLink({ organizationId }: { organizationId: string }) {
  const current = currentSegment(usePathname()) === 'setup';

  return (
    <Link
      href={areaHref(organizationId, 'setup')}
      aria-current={current ? 'page' : undefined}
      className={cx(FOCUS_RING, PHONE_ROW, current ? 'bg-foreground font-medium text-background' : 'hover:bg-hover')}
    >
      <ListChecks aria-hidden size={18} className="shrink-0" />
      <span className="min-w-0">Setup</span>
    </Link>
  );
}

/**
 * The whole operator sidebar: identity and context switching in the header, Setup (while it
 * applies) and the projected sections in the content, the account menu in the footer.
 * `collapsible="icon"` and everything collapse-related is `Sidebar`'s own state, shared with every
 * other workspace shell rather than a second, `localStorage`-backed implementation beside it.
 */
export function OrgSidebar({
  organizationId,
  mark,
  name,
  role,
  organizations,
  sections,
  setup,
  email,
  signOutAction,
  ...props
}: {
  organizationId: string;
  mark: ReactNode;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  sections: ShellSection[];
  /** True only while the business is in SETUP — the layout decides, from `operationalState`. */
  setup?: boolean;
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <ContextSwitcher
          mark={mark}
          current={{ kind: 'business', organizationId, name, role }}
          organizations={organizations}
        />
      </SidebarHeader>
      <SidebarContent>
        {setup ? <SetupEntry organizationId={organizationId} /> : null}
        <OrgNav sections={sections} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><AccountMenu email={email} signOutAction={signOutAction} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * The sidebar while the business's commercial service access is locked: identity and context
 * switching, one row to where recovery lives, and the account menu. Not the enforcement — every
 * page and action refuses on its own — only the shell agreeing with them, so a locked person is
 * not offered twelve doors that all lead to the same locked screen.
 */
export function LockedOrgSidebar({
  organizationId,
  mark,
  name,
  role,
  organizations,
  email,
  signOutAction,
  ...props
}: {
  organizationId: string;
  mark: ReactNode;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  const current = usePathname().includes('/settings/plan');

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <ContextSwitcher
          mark={mark}
          current={{ kind: 'business', organizationId, name, role }}
          organizations={organizations}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={current} tooltip="Plan & usage">
                <Link
                  href={`/organizations/${organizationId}/settings/plan`}
                  aria-current={current ? 'page' : undefined}
                >
                  <Settings aria-hidden />
                  <span>Plan &amp; usage</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><AccountMenu email={email} signOutAction={signOutAction} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
