'use client';

import { AccountMenu } from '@/components/containers/account-menu';
import { Badge } from '@/components/display/data';
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
  Bot,
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  Layers,
  LayoutDashboard,
  MapPin,
  Package,
  Phone,
  Plug,
  Settings,
  Sparkles,
  SlidersHorizontal,
  Tag,
  UserCog,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  AREAS,
  AREA_GROUPS,
  areaHref,
  areaRootSegment,
  areasIn,
  currentSegment,
  visibleAreas,
  type Area,
} from '@/lib/navigation';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { PLATFORM_NAV } from '@/features/platform/platform-navigation';

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
  ask: Bot,
  locations: MapPin,
  assets: Package,
  resources: Layers,
  reports: BarChart3,
  pricing: Tag,
  automations: Zap,
  fields: SlidersHorizontal,
  roles: UserCog,
  setup: Sparkles,
  integrations: Plug,
  settings: Settings,
};

/**
 * The tablet and desktop rendering: `Sidebar`'s own grouped-menu vocabulary, one `SidebarGroup`
 * per `AREA_GROUPS` entry in order — operations first and configuration last (D23 — never reach
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
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
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
        current ? 'bg-foreground font-medium text-background' : 'hover:bg-black/5 dark:hover:bg-white/10',
      )}
    >
      {Icon ? <Icon aria-hidden size={18} className="shrink-0" /> : null}
      <span className="min-w-0">{area.label}</span>
    </Link>
  );
}

function PlatformPhoneNavLink({ item, current }: { item: (typeof PLATFORM_NAV)[number]; current: boolean }) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
      className={cx(
        FOCUS_RING,
        'flex items-center justify-center gap-2 rounded px-3 py-1.5 text-sm',
        current ? 'bg-foreground font-medium text-background' : 'hover:bg-black/5 dark:hover:bg-white/10',
      )}
    >
      <Icon aria-hidden size={18} className="shrink-0" />
      <span className="min-w-0">{item.label}</span>
    </Link>
  );
}

/**
 * The phone rendering of the same `AREAS` list — a fixed bar along the bottom that scrolls
 * sideways rather than collapsing into a drawer (`ui-spec.md` §2 says why: a drawer needs
 * state, a toggle, a focus trap and an escape key to be correct, and a bar needs none of it).
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
  platformStaff = false,
  isGoldInternal = false,
}: {
  organizationId: string;
  enabledModules: string[];
  capabilities: Capability[];
  /** Same resolved set `OrgNav` receives — one shared predicate (`visibleAreas`), so the two can't drift. */
  featureAvailability: string[];
  platformStaff?: boolean;
  isGoldInternal?: boolean;
}) {
  const pathname = usePathname();
  const segment = currentSegment(pathname);
  const enabled = new Set(enabledModules);
  const capabilitySet = new Set(capabilities);
  const featureSet = new Set(featureAvailability);

  return (
    <nav
      aria-label="This business"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background md:hidden"
    >
      <ul className="flex gap-1 overflow-x-auto p-2">
        {visibleAreas(enabled, capabilitySet, featureSet).map((area) => (
          <li key={area.segment} className="shrink-0">
            <PhoneNavLink
              organizationId={organizationId}
              area={area}
              current={area.segment === segment}
            />
          </li>
        ))}
        {platformStaff && isGoldInternal
          ? PLATFORM_NAV.map((item) => {
              const current = item.href === '/platform'
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href} className="shrink-0">
                  <PlatformPhoneNavLink item={item} current={current} />
                </li>
              );
            })
          : null}
      </ul>
    </nav>
  );
}

/**
 * The elevated, accent-coloured entry Business Setup gets instead of an ordinary row — not a
 * `SidebarGroupLabel`'d group of its own, since `SetupBadge`/the layout decide *when* (only
 * while `organization.operationalState === 'setup'`), and this is just what it looks like once
 * that's true. Same collapse-to-icon and tooltip behaviour as every other row.
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
            tooltip="Set up your business"
            className="bg-accent text-on-accent hover:bg-accent hover:text-on-accent data-[active=true]:bg-accent data-[active=true]:text-on-accent"
          >
            <Link href={areaHref(organizationId, 'setup')} aria-current={current ? 'page' : undefined}>
              <Sparkles aria-hidden />
              <span>Set up your business</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}

/** Desktop shortcut group only: the shared registry still owns every platform destination. */
function GoldPlatformNav() {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {PLATFORM_NAV.map((item) => {
            const Icon = item.icon;
            const active = item.href === '/platform'
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                  <Link href={item.href} aria-current={active ? 'page' : undefined}>
                    <Icon aria-hidden />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The whole operator sidebar: identity and business switching in the header, Business Setup
 * (while it applies) and the grouped area list in the content, the account menu in the footer.
 * `collapsible="icon"` and everything collapse-related is `Sidebar`'s own state, shared with the
 * platform console rather than a second, `localStorage`-backed implementation beside it.
 */
export function OrgSidebar({
  organizationId,
  mark,
  name,
  role,
  organizations,
  platformStaff,
  isGoldInternal,
  enabledModules,
  capabilities,
  featureAvailability,
  setupEntry,
  email,
  signOutAction,
  ...props
}: {
  organizationId: string;
  mark: ReactNode;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  platformStaff: boolean;
  /** Server-resolved from a real membership plus the current `gold_internal` base Plan. */
  isGoldInternal: boolean;
  enabledModules: string[];
  capabilities: Capability[];
  featureAvailability: string[];
  /** `<SetupEntry />`, or nothing — the layout decides, from `operationalState`, the same place `SetupBadge` is decided. */
  setupEntry?: ReactNode;
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
          platformStaff={platformStaff}
        />
      </SidebarHeader>
      <SidebarContent>
        {setupEntry}
        <OrgNav
          organizationId={organizationId}
          enabledModules={enabledModules}
          capabilities={capabilities}
          featureAvailability={featureAvailability}
        />
        {platformStaff && isGoldInternal ? <GoldPlatformNav /> : null}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border"><AccountMenu email={email} signOutAction={signOutAction} /></SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/**
 * The header's version of the same fact, for the width the sidebar is not there at all —
 * `ui-spec.md` §2's rule against a second permanent bottom-nav destination on a phone is why
 * this is a header treatment rather than a fourth thing in `OrgNavBar`.
 */
export function SetupBadge({ organizationId }: { organizationId: string }) {
  return (
    <Link href={areaHref(organizationId, 'setup')} className={cx(FOCUS_RING, 'rounded shrink-0')}>
      <Badge tone="accent">Setting up</Badge>
    </Link>
  );
}

/**
 * Where you are, in the header bar.
 *
 * **Still one string doing two jobs.** An area page carries no `<h1>` of its own — the entry in
 * `navigation.ts` is the navigation label and the heading both, exactly as before. What changed is
 * where it renders: in the shell's header rather than at the top of the content column, so it
 * stays on screen while a long list scrolls under it.
 *
 * On a detail route it becomes the way back instead. `areaRootSegment` is what tells the two
 * apart — a job is *in* Work but not *at* it — and there the page writes its own `<h1>`, because
 * a job's title is a tenant's words and not a platform noun.
 *
 * **An area with `parent` set gets a small link above its heading, reading whose it is** — for
 * an area that stays a real, directly addressable route (`sidebar: false`) without being a
 * permanent row in the ordinary sidebar, so somebody arriving straight from a bookmark or
 * another area's own configuration link still needs to be told where they've landed. No area
 * currently sets `parent`; the parent's own `label` would be read off its `Area` entry rather
 * than written again here, which is what keeps this a single registry if one does.
 */
export function AreaTrail({ organizationId }: { organizationId: string }) {
  const pathname = usePathname();
  const area = AREAS.find((candidate) => candidate.segment === currentSegment(pathname));
  if (!area) return null;

  if (areaRootSegment(pathname) !== null) {
    const parent = area.parent ? AREAS.find((candidate) => candidate.segment === area.parent) : null;

    return (
      <div className="min-w-0">
        {parent ? (
          <Link
            href={areaHref(organizationId, parent.segment)}
            className={cx(
              'block text-xs text-muted underline-offset-4 hover:underline',
              FOCUS_RING,
            )}
          >
            {parent.label}
          </Link>
        ) : null}
        <h1 className="min-w-0 truncate text-lg font-semibold leading-tight">{area.label}</h1>
      </div>
    );
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <Link
        href={areaHref(organizationId, area.segment)}
        className={cx(
          'flex min-w-0 items-center gap-1 rounded text-sm text-muted underline-offset-4 hover:underline',
          FOCUS_RING,
        )}
      >
        <ChevronLeft aria-hidden size={16} className="shrink-0" />
        <span className="truncate">{area.label}</span>
      </Link>
    </nav>
  );
}

export function PlatformTrail() {
  const pathname = usePathname();
  const active = [...PLATFORM_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => (item.href === '/platform' ? pathname === item.href : pathname.startsWith(item.href)));

  return <h1 className="min-w-0 truncate text-lg font-semibold leading-tight">{active?.label ?? 'Platform'}</h1>;
}
