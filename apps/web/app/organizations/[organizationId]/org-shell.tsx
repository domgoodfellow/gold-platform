'use client';

import { AccountMenu } from '@/components/containers/account-menu';
import { Badge } from '@/components/display/data';
import { Avatar, AvatarFallback } from '@gold/ui/components/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@gold/ui/components/dropdown-menu';
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
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronsUpDown,
  ClipboardList,
  Layers,
  LayoutDashboard,
  MapPin,
  Package,
  Phone,
  Plug,
  Settings,
  ShieldCheck,
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
  type Area,
} from '@/lib/navigation';

/**
 * The two pieces of the shell that need to know which area is on screen. Client components
 * because a layout can't read its own pathname server-side. Neither reads a capability
 * (navigation shows every area to every member); they do read which modules are enabled, since
 * that's the business's own shape rather than a permission — decided server-side under RLS and
 * passed down from the layout.
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
}: {
  organizationId: string;
  enabledModules: string[];
}) {
  const segment = currentSegment(usePathname());
  const enabled = new Set(enabledModules);

  return (
    <nav aria-label="This business">
      {AREA_GROUPS.map((group) => {
        const areas = areasIn(group.key, enabled);
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

/** One organization the caller can switch into — never more than `listMyOrganizations` itself would return under the caller's own RLS. */
export type SwitchableOrganization = {
  id: string;
  name: string;
  role: string;
};

/**
 * Organization identity is the organization control, and — since platform authority stopped
 * being a Postgres role a session had to choose between wearing and being a member
 * (20260915000001) — the one place a caller who holds both sees them side by side in one menu.
 * `organizations` is never a static or guessed list: it is exactly what `listMyOrganizations`
 * returned for this caller, under their own RLS, and `platformStaff` is `isPlatformStaff`'s own
 * answer — nothing here decides who may see what.
 */
export function OrganizationSwitcher({
  mark,
  organizationId,
  name,
  role,
  organizations,
  platformStaff,
}: {
  mark: ReactNode;
  organizationId: string;
  name: string;
  role: string;
  organizations: SwitchableOrganization[];
  platformStaff: boolean;
}) {
  const others = organizations.filter((organization) => organization.id !== organizationId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={name}
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {mark}
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="flex items-center gap-1">
                  <span className="truncate font-semibold">{name}</span>
                  <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
                </span>
                <span className="truncate text-xs text-sidebar-foreground/70">{role}</span>
              </div>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start" className="w-64 min-w-64">
            <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2"><Avatar><AvatarFallback>{name.charAt(0).toUpperCase()}</AvatarFallback></Avatar><span className="min-w-0"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs font-normal text-muted">{role}</span></span></DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href={areaHref(organizationId, 'settings')}><Settings /> Organization settings</Link></DropdownMenuItem>

            {others.length > 0 ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 text-xs uppercase tracking-wide text-subtle">Organizations</DropdownMenuLabel>
                {others.map((organization) => (
                  <DropdownMenuItem key={organization.id} asChild>
                    <Link href={`/organizations/${organization.id}`}>
                      <Building2 /> {organization.name}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}

            {platformStaff ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 text-xs uppercase tracking-wide text-subtle">Platform</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/platform">
                    <ShieldCheck /> Platform Administration
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuItem asChild><Link href="/organizations?all=1">All businesses</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

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
}: {
  organizationId: string;
  enabledModules: string[];
}) {
  const segment = currentSegment(usePathname());
  const enabled = new Set(enabledModules);

  return (
    <nav
      aria-label="This business"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background md:hidden"
    >
      <ul className="flex gap-1 overflow-x-auto p-2">
        {AREAS.filter(
          (area) => area.sidebar !== false && (!area.module || enabled.has(area.module)),
        ).map((area) => (
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
  enabledModules,
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
  enabledModules: string[];
  /** `<SetupEntry />`, or nothing — the layout decides, from `operationalState`, the same place `SetupBadge` is decided. */
  setupEntry?: ReactNode;
  email: string;
  signOutAction: () => Promise<void>;
} & React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border">
        <OrganizationSwitcher
          mark={mark}
          organizationId={organizationId}
          name={name}
          role={role}
          organizations={organizations}
          platformStaff={platformStaff}
        />
      </SidebarHeader>
      <SidebarContent>
        {setupEntry}
        <OrgNav organizationId={organizationId} enabledModules={enabledModules} />
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
 * **An area with `parent` set gets a small link above its heading, reading whose it is.**
 * Pricing, Automations, Custom fields and People and roles all left the sidebar for Settings in
 * Slice 3 without moving anywhere — the same route, the same href, still directly bookmarkable
 * — so somebody arriving at one straight from a bookmark or a module's own configuration link
 * still needs to be told where they've landed. The parent's own `label` is read off its `Area`
 * entry rather than written again here, which is what keeps this a single registry.
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
