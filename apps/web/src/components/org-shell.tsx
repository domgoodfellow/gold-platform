'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AREAS, areaHref, areaRootSegment, currentSegment } from '@/lib/navigation';

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
 */

export function OrgNav({ organizationId }: { organizationId: string }) {
  const segment = currentSegment(usePathname());

  return (
    <nav aria-label="This business" className="min-w-0">
      {/*
        The responsive decision, made rather than inherited: one horizontal strip that
        scrolls below `md`, one column at `md` and up. There is deliberately no drawer — a
        drawer needs state, a toggle, a focus trap and an escape key to be correct, and it
        buys nothing here, because nine entries fit in a strip an operator can thumb
        through. On a phone somebody is looking at one board, not navigating a hierarchy.
      */}
      <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3">
        {AREAS.map((area) => {
          const current = area.segment === segment;
          return (
            <li key={area.segment} className="shrink-0 md:shrink">
              <Link
                href={areaHref(organizationId, area.segment)}
                aria-current={current ? 'page' : undefined}
                className={
                  current
                    ? 'block rounded bg-foreground px-3 py-1.5 text-sm font-medium text-background'
                    : 'block rounded px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10'
                }
              >
                {area.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
