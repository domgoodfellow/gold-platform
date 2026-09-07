'use client';

import { PageHeading } from '@/components/containers/section';
import { cx, FOCUS_RING } from '@/components/class-names';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  CalendarDays,
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
  labelClassName,
}: {
  organizationId: string;
  area: Area;
  current: boolean;
  className: string;
  labelClassName?: string;
}) {
  const Icon = AREA_ICONS[area.segment];

  return (
    <Link
      href={areaHref(organizationId, area.segment)}
      aria-current={current ? 'page' : undefined}
      aria-label={area.label}
      title={area.label}
      className={cx(
        className,
        FOCUS_RING,
        current
          ? 'bg-foreground font-medium text-background'
          : 'hover:bg-black/5 dark:hover:bg-white/10',
      )}
    >
      <span className="flex items-center gap-2">
        {Icon ? <Icon aria-hidden size={18} className="shrink-0" /> : null}
        <span className={labelClassName}>{area.label}</span>
      </span>
    </Link>
  );
}

/**
 * The information architecture, rendered twice — one `AREAS` list, two presentations, so they
 * can't drift. On a phone it's a bottom bar that scrolls horizontally rather than collapsing
 * into a drawer, which would need its own state and focus trap to be correct. From `md` up it's
 * a column with operational above configuration (D23: never reach today's work through settings)
 * — icon-only between `md` and `lg` (the tablet rail), icon and label from `lg` (desktop).
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
    <>
      <nav
        aria-label="This business"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background md:hidden"
      >
        <ul className="flex gap-1 overflow-x-auto p-2">
          {AREAS.filter((area) => !area.module || enabled.has(area.module)).map((area) => (
            <li key={area.segment} className="shrink-0">
              <NavLink
                organizationId={organizationId}
                area={area}
                current={area.segment === segment}
                className="block rounded px-3 py-1.5 text-sm"
              />
            </li>
          ))}
        </ul>
      </nav>

      {/* Hidden from assistive tech on phones via `hidden`, not duplicated, so only one rendering is ever in the accessibility tree. */}
      <nav aria-label="This business" className="hidden min-w-0 p-3 md:block">
        {(['operational', 'configuration'] as const).map((group, index) => (
          <ul
            key={group}
            className={
              index === 0
                ? 'flex flex-col gap-1'
                : 'mt-3 flex flex-col gap-1 border-t border-border pt-3 '
            }
          >
            {areasIn(group, enabled).map((area) => (
              <li key={area.segment}>
                <NavLink
                  organizationId={organizationId}
                  area={area}
                  current={area.segment === segment}
                  className="block rounded px-3 py-1.5 text-sm"
                  labelClassName="hidden lg:inline"
                />
              </li>
            ))}
          </ul>
        ))}
      </nav>
    </>
  );
}

/** No page under `[organizationId]` carries its own `<h1>` — one string, rendered here, is both nav entry and heading. */
export function AreaHeading() {
  // `areaRootSegment`, not `currentSegment` — a detail route is *in* an area but not *at* it.
  const segment = areaRootSegment(usePathname());
  const area = AREAS.find((candidate) => candidate.segment === segment);
  if (!area) return null;

  return <PageHeading>{area.label}</PageHeading>;
}
