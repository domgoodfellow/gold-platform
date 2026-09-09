'use client';


import { SidebarLabel, useSidebarCollapsed } from '@/components/containers/app-shell';
import { cx, FOCUS_RING } from '@/components/class-names';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
  settings: Settings,
};

function NavLink({
  organizationId,
  area,
  current,
  className,
}: {
  organizationId: string;
  area: Area;
  current: boolean;
  className: string;
}) {
  const Icon = AREA_ICONS[area.segment];
  const collapsed = useSidebarCollapsed();

  return (
    <Link
      href={areaHref(organizationId, area.segment)}
      aria-current={current ? 'page' : undefined}
      aria-label={area.label}
      title={area.label}
      className={cx(
        className,
        FOCUS_RING,
        'flex items-center justify-center gap-2',
        !collapsed && 'lg:justify-start',
        current
          ? 'bg-foreground font-medium text-background'
          : 'hover:bg-black/5 dark:hover:bg-white/10',
      )}
    >
      {Icon ? <Icon aria-hidden size={18} className="shrink-0" /> : null}
      <SidebarLabel>{area.label}</SidebarLabel>
    </Link>
  );
}

/**
 * The tablet and desktop rendering: a column of labelled sections in `AREA_GROUPS` order, with
 * operations first and configuration last (D23 — never reach today's work through settings).
 * Icon-only between `md` and `lg`, icon and label from `lg`. `OrgNavBar` below is the phone
 * rendering of the same list. One `AREAS`, two presentations, so they cannot drift.
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
    <nav aria-label="This business" className="min-w-0 p-3">
      {AREA_GROUPS.map((group, index) => {
        const areas = areasIn(group.key, enabled);
        // A business with every module in a section switched off has no section. Rendering the
        // heading anyway would name a part of the application that is not there for them.
        if (areas.length === 0) return null;

        return (
          <div key={group.key} className={index === 0 ? '' : 'mt-4 border-t border-border pt-4'}>
            {/* Hidden with the labels in the icon-only rail: a heading over three icons is a
                word with nothing to attach to. The rule between sections still separates them. */}
            <SidebarLabel block>
              <span className="mb-1 block px-3 text-xs uppercase tracking-wide text-subtle">
                {group.label}
              </span>
            </SidebarLabel>
            <ul className="flex flex-col gap-1">
              {areas.map((area) => (
                <li key={area.segment}>
                  <NavLink
                    organizationId={organizationId}
                    area={area}
                    current={area.segment === segment}
                    className="rounded px-3 py-1.5 text-sm"
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * The phone rendering of the same `AREAS` list — a fixed bar along the bottom that scrolls
 * sideways rather than collapsing into a drawer (`ui-spec.md` §2 says why).
 *
 * It is a separate export rather than a second `<nav>` inside `OrgNav` because the sidebar it
 * used to sit in is now hidden below `md`, and `display: none` on an ancestor takes a `fixed`
 * descendant with it. Same list, same `NavLink`, still two renderings and not three.
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
        {AREAS.filter((area) => !area.module || enabled.has(area.module)).map((area) => (
          <li key={area.segment} className="shrink-0">
            <NavLink
              organizationId={organizationId}
              area={area}
              current={area.segment === segment}
              className="rounded px-3 py-1.5 text-sm"
            />
          </li>
        ))}
      </ul>
    </nav>
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
 */
export function AreaTrail({ organizationId }: { organizationId: string }) {
  const pathname = usePathname();
  const area = AREAS.find((candidate) => candidate.segment === currentSegment(pathname));
  if (!area) return null;

  if (areaRootSegment(pathname) !== null) {
    return <h1 className="min-w-0 truncate text-lg font-semibold">{area.label}</h1>;
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
