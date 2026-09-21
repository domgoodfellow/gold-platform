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
import { cx, FOCUS_RING } from '@/components/class-names';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Layers,
  LayoutDashboard,
  MapPin,
  Package,
  Phone,
  Settings,
  ListChecks,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  AREA_GROUPS,
  areaHref,
  areasIn,
  currentSegment,
  visibleAreas,
  type Area,
} from '@/lib/navigation';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The two pieces of the shell that need to know which area is on screen. Client components
 * because a layout can't read its own pathname server-side. Both read the same three facts the
 * layout resolves once and passes down — legacy module keys, the canonical resolver's available
 * Feature keys, and this role's capabilities — through the one shared `visibleAreas`/`areasIn`
 * predicate, so desktop and mobile can never disagree about what a caller can see. Most of the
 * kernel and general-purpose areas still show themselves to every member regardless of
 * capability (I12): `Area.relevantCapabilities` is the narrow, feature-specific exception, and a
 * business's own module/entitlement shape (not a permission) is what the other two axes decide.
 */

/**
 * One icon per area, keyed by segment rather than declared on `Area` itself — icon choice is how
 * the shell draws the IA, not part of what the IA is (`navigation.ts` stays segments, labels,
 * groups, modules). `navigation.test.ts` asserts every `AREAS` entry has one here, so a new area
 * without an icon fails at the gate rather than rendering blank in the rail.
 */
export const AREA_ICONS: Record<string, LucideIcon> = {
  today: LayoutDashboard,
  work: ClipboardList,
  schedule: CalendarDays,
  customers: Users,
  calls: Phone,
  locations: MapPin,
  assets: Package,
  resources: Layers,
  reports: BarChart3,
  automations: Zap,
  setup: ListChecks,
  settings: Settings,
};

/**
 * The tablet and desktop rendering: `Sidebar`'s own grouped-menu vocabulary, one `SidebarGroup`
 * per `AREA_GROUPS` entry in order — work first and Settings last (D23 — never reach
 * today's work through settings). Collapse-to-icon, the tooltip that appears while collapsed,
 * and the `md`-and-up-only rendering are all `Sidebar`'s own, not reimplemented here. `OrgNavBar`
 * below is the phone rendering of the same list. One `AREAS`, two presentations, so they cannot
 * drift.
 */
export function OrgNav({
  organizationId,
  enabledModules,
  capabilities,
  featureAvailability,
}: {
  organizationId: string;
  enabledModules: string[];
  /** Which areas this role's capabilities make relevant — layered on top of the module/feature gate (I12). */
  capabilities: Capability[];
  /** Canonical Feature keys this business is currently entitled to, active and implemented for — `availableFeatureKeys(organizationResolvedFeatureStates(...))`, resolved once by the layout. */
  featureAvailability: string[];
}) {
  const segment = currentSegment(usePathname());
  const enabled = new Set(enabledModules);
  const capabilitySet = new Set(capabilities);
  const featureSet = new Set(featureAvailability);

  return (
    <nav aria-label="This business">
      {AREA_GROUPS.map((group) => {
        const areas = areasIn(group.key, enabled, capabilitySet, featureSet);
        // A business with every module in a section switched off has no section. Rendering the
        // heading anyway would name a part of the application that is not there for them.
        if (areas.length === 0) return null;

        return (
          <SidebarGroup key={group.key}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {areas.map((area) => {
                  const Icon = AREA_ICONS[area.segment];
                  const current = area.segment === segment;
                  return (
                    <SidebarMenuItem key={area.segment}>
                      <SidebarMenuButton asChild isActive={current} tooltip={area.label}>
                        <Link href={areaHref(organizationId, area.segment)} aria-current={current ? 'page' : undefined}>
                          {Icon ? <Icon aria-hidden /> : null}
                          <span>{area.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
    </nav>
  );
}

export type { SwitchableOrganization };

/** A single row in the phone bar — plain Tailwind, not `Sidebar`'s vocabulary, since this list never collapses and never sits inside a `Sidebar` at all (see `OrgNavBar`). */
function PhoneNavLink({
  organizationId,
  area,
  current,
}: {
  organizationId: string;
  area: Area;
  current: boolean;
}) {
  const Icon = AREA_ICONS[area.segment];

  return (
    <Link
      href={areaHref(organizationId, area.segment)}
      aria-current={current ? 'page' : undefined}
      aria-label={area.label}
      title={area.label}
      className={cx(
        FOCUS_RING,
        'flex items-center justify-center gap-2 rounded px-3 py-1.5 text-sm',
        current ? 'bg-foreground font-medium text-background' : 'hover:bg-hover',
      )}
    >
      {Icon ? <Icon aria-hidden size={18} className="shrink-0" /> : null}
      <span className="min-w-0">{area.label}</span>
    </Link>
  );
}

/**
 * The phone rendering of the same `AREAS` list — a fixed bar along the bottom that scrolls
 * sideways rather than collapsing into a drawer (`ui-spec.md` §2 says why: a drawer needs
 * state, a toggle, a focus trap and an escape key to be correct, and a bar needs none of it).
 *
 * It lists this business's places and nothing else: Platform Administration is a different
 * scope, reached through the context switcher in the header, and has its own bar
 * (`PlatformNavBar`) — never a doorway inside a business's navigation.
 *
 * It renders outside `Sidebar` entirely, never inside it: shadcn's own mobile rendering below
 * `md` is an off-canvas sheet, which is exactly the drawer this bar exists to avoid. `AppShell`
 * places it as a sibling of `SidebarInset`, and no trigger anywhere reaches the sidebar's sheet
 * below `md`, so that sheet mounts closed and renders nothing at that width — this bar is what a
 * phone actually sees.
 */
export function OrgNavBar({
  organizationId,
  enabledModules,
  capabilities,
  featureAvailability,
  setup = false,
}: {
  organizationId: string;
  enabledModules: string[];
  capabilities: Capability[];
  /** Same resolved set `OrgNav` receives — one shared predicate (`visibleAreas`), so the two can't drift. */
  featureAvailability: string[];
  /** True only while the business is in SETUP — the layout decides, and it leaves the bar the moment the business is LIVE. */
  setup?: boolean;
}) {
  const segment = currentSegment(usePathname());
  const enabled = new Set(enabledModules);
  const capabilitySet = new Set(capabilities);
  const featureSet = new Set(featureAvailability);

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
        {visibleAreas(enabled, capabilitySet, featureSet).map((area) => (
          <li key={area.segment} className="shrink-0">
            <PhoneNavLink
              organizationId={organizationId}
              area={area}
              current={area.segment === segment}
            />
          </li>
        ))}
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
      className={cx(
        FOCUS_RING,
        'flex items-center justify-center gap-2 rounded px-3 py-1.5 text-sm',
        current ? 'bg-foreground font-medium text-background' : 'hover:bg-hover',
      )}
    >
      <ListChecks aria-hidden size={18} className="shrink-0" />
      <span className="min-w-0">Setup</span>
    </Link>
  );
}

/**
 * The whole operator sidebar: identity and context switching in the header, Setup (while it
 * applies) and the grouped area list in the content, the account menu in the footer. It holds
 * this business's places only — Platform Administration is another context, entered from the
 * switcher. `collapsible="icon"` and everything collapse-related is `Sidebar`'s own state, shared
 * with the platform console rather than a second, `localStorage`-backed implementation beside it.
 */
export function OrgSidebar({
  organizationId,
  mark,
  name,
  role,
  organizations,
  platformAdministration,
  enabledModules,
  capabilities,
  featureAvailability,
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
  /** The switcher offers Platform Administration (`platformAdministrationAvailable`). */
  platformAdministration: boolean;
  enabledModules: string[];
  capabilities: Capability[];
  featureAvailability: string[];
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
          platformAdministration={platformAdministration}
        />
      </SidebarHeader>
      <SidebarContent>
        {setup ? <SetupEntry organizationId={organizationId} /> : null}
        <OrgNav
          organizationId={organizationId}
          enabledModules={enabledModules}
          capabilities={capabilities}
          featureAvailability={featureAvailability}
        />
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
  platformAdministration,
  email,
  signOutAction,
  ...props
}: {
  organizationId: string;
  mark: ReactNode;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  platformAdministration: boolean;
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
          platformAdministration={platformAdministration}
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
