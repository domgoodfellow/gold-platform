'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AREAS,
  areaHref,
  areaRootSegment,
  areasIn,
  currentSegment,
  type Area,
} from '@/lib/navigation';

/**
 * The two pieces of the shell that have to know which area is on screen.
 *
 * A layout cannot be told its own pathname on the server, so these are client components —
 * which costs nothing at first paint, because Next renders them on the server too and
 * `usePathname` is correct there. They hold no state and no effects; there is nothing to
 * hydrate but the links.
 *
 * Neither reads a capability. See `lib/navigation.ts` for why the shell shows every area to
 * every member and lets each screen explain what a role cannot do.
 *
 * **They do read which modules the business has enabled, and that is not the same thing.** A
 * role decides what a member may do inside this business; a module decides what this business
 * bought. Hiding a screen for the first would make this file the authorization boundary, which
 * I12 says it is not. Hiding it for the second is showing a business its own shape. The set
 * arrives from the layout, which reads it server-side under RLS — nothing is decided here.
 */

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
  return (
    <Link
      href={areaHref(organizationId, area.segment)}
      aria-current={current ? 'page' : undefined}
      className={
        current
          ? `${className} bg-foreground font-medium text-background`
          : `${className} hover:bg-black/5 dark:hover:bg-white/10`
      }
    >
      {area.label}
    </Link>
  );
}

/**
 * The information architecture, rendered twice.
 *
 * **The areas do not change across breakpoints; only their presentation does**, which is what
 * D23 adopts and is why both renderings map the same `AREAS` rather than each holding a list.
 * Two lists that had to agree eventually would not.
 *
 * On a phone the bar is fixed to the bottom, because the thing an operator does on a phone is
 * ask what to do next while holding it one-handed, and the top of a large screen is the one
 * place a thumb does not reach. It scrolls horizontally rather than collapsing into a drawer
 * or a "More" menu: a drawer needs state, a toggle, a focus trap and an escape key to be
 * correct, and a "More" menu would be the second place an area could live.
 *
 * From `md` up it is a column, and the two groups are ruled apart. D23: "An operator must
 * never reach today's work by going through settings."
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
      {/* Phone: fixed to the bottom, out of the document flow. The layout reserves the space
          with padding so the last row of a screen is never sitting underneath this. */}
      <nav
        aria-label="This business"
        className="fixed inset-x-0 bottom-0 z-10 border-t border-black/10 bg-background md:hidden dark:border-white/15"
      >
        <ul className="flex gap-1 overflow-x-auto p-2">
          {/* Ungrouped on a phone — the rule between operational and configuration is the
              column rendering's, and a horizontal bar has nowhere to put it. Same filter as
              `areasIn` applies: no module named means the kernel, which is always here. */}
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

      {/* Tablet and desktop: one column, operational above the rule and configuration below
          it. Hidden from assistive technology on phones by the `hidden` class rather than
          duplicated, so the two renderings are never both in the accessibility tree. */}
      <nav aria-label="This business" className="hidden min-w-0 p-3 md:block">
        {(['operational', 'configuration'] as const).map((group, index) => (
          <ul
            key={group}
            className={
              index === 0
                ? 'flex flex-col gap-1'
                : 'mt-3 flex flex-col gap-1 border-t border-black/10 pt-3 dark:border-white/15'
            }
          >
            {areasIn(group, enabled).map((area) => (
              <li key={area.segment}>
                <NavLink
                  organizationId={organizationId}
                  area={area}
                  current={area.segment === segment}
                  className="block rounded px-3 py-1.5 text-sm"
                />
              </li>
            ))}
          </ul>
        ))}
      </nav>
    </>
  );
}

/**
 * The page's heading, read from the same row as its navigation entry.
 *
 * No page under `[organizationId]` carries an `<h1>` of its own. That is the mechanism
 * behind `lib/navigation.ts`'s claim to hold every platform noun: one string, rendered
 * twice, so the two cannot drift and an override has one place to reach.
 */
export function AreaHeading() {
  // `areaRootSegment`, not `currentSegment`: a detail route is *in* an area but not *at*
  // it, and renders its own heading. See `lib/navigation.ts`.
  const segment = areaRootSegment(usePathname());
  const area = AREAS.find((candidate) => candidate.segment === segment);
  if (!area) return null;

  return <h1 className="text-2xl font-semibold">{area.label}</h1>;
}
