import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AREAS,
  MODULES,
  areaHref,
  areaRootSegment,
  areasIn,
  currentSegment,
} from '@/lib/navigation';

/**
 * The shell's navigation is the only place the platform's own nouns are written down, and
 * this file is what makes that a fact rather than an intention.
 *
 * Unlike every other suite here it touches no database, because there is no policy to
 * prove — `lib/navigation.ts` deliberately gates nothing, and the reason is written there.
 * What it proves instead is completeness in both directions: a route with no navigation
 * entry is unreachable except by typing its URL, and an entry with no route is a dead link.
 * Both were live risks the moment nine pages stopped linking to each other and started
 * linking to a list.
 */

const ROUTES = fileURLToPath(new URL('../app/organizations/[organizationId]', import.meta.url));

/** Direct child route directories that render a page — the areas of one business. */
function routeSegmentsOnDisk(): string[] {
  return readdirSync(ROUTES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // A dynamic segment is a detail route inside an area, not an area: `[customerId]`
    // belongs to Customers. Nothing like that exists at this level today, and the filter is
    // here so that adding one does not read as a missing navigation entry.
    .filter((entry) => !entry.name.startsWith('[') && !entry.name.startsWith('_'))
    .filter((entry) => existsSync(`${ROUTES}/${entry.name}/page.tsx`))
    .map((entry) => entry.name)
    .sort();
}

describe('the operator shell navigation', () => {
  it('points every entry at a route that exists', () => {
    for (const area of AREAS) {
      expect(
        existsSync(`${ROUTES}/${area.segment}/page.tsx`),
        `navigation names "${area.segment}", which has no page`,
      ).toBe(true);
    }
  });

  it('names every area a business has', () => {
    // The direction that catches the real mistake. Adding a screen and forgetting the
    // navigation used to be invisible, because the index page listed areas by hand and
    // nothing compared the two lists.
    expect([...AREAS].map((area) => area.segment).sort()).toEqual(routeSegmentsOnDisk());
  });

  it('gives every area a label and no two the same', () => {
    // The labels are also the page headings, so a duplicate is two screens claiming to be
    // the same thing, and an empty one is a heading that renders as nothing.
    const labels = AREAS.map((area) => area.label);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('marks the area a detail route belongs to', () => {
    const [work] = AREAS;
    expect(currentSegment(areaHref('org-1', work.segment))).toBe(work.segment);
    expect(currentSegment(`/organizations/org-1/${work.segment}/item-9`)).toBe(work.segment);
    expect(currentSegment(`/organizations/org-1/${work.segment}?type=abc`)).toBe(work.segment);
  });

  it('is at an area only on the area itself, never on a route inside it', () => {
    // The bug this exists for: the shell renders the area label as the page's <h1>, and a
    // detail screen already has one — the job's title, the customer's name. Marked *in* the
    // area for navigation, not *at* it for the heading.
    const [work] = AREAS;
    expect(areaRootSegment(areaHref('org-1', work.segment))).toBe(work.segment);
    expect(areaRootSegment(`/organizations/org-1/${work.segment}?type=abc`)).toBe(work.segment);
    expect(areaRootSegment(`/organizations/org-1/${work.segment}/item-9`)).toBeNull();
    expect(currentSegment(`/organizations/org-1/${work.segment}/item-9`)).toBe(work.segment);
  });

  it('marks no area outside a business, or on a segment it does not own', () => {
    expect(currentSegment('/organizations')).toBeNull();
    expect(currentSegment('/sign-in')).toBeNull();
    // A route that exists but is not an area — today the document download handler. The
    // shell highlights nothing rather than guessing.
    expect(currentSegment('/organizations/org-1/documents/doc-1/download')).toBeNull();
  });

  it('puts every operational area ahead of every configuration one (D23)', () => {
    // "An operator must never reach today's work by going through settings." The order used
    // to carry that claim and nothing held it, which made it the accident D23 says a later
    // contributor would be free to tidy away. The sidebar rules between the two groups, so
    // an interleaved list would render a divider in the middle of the operational half.
    const groups = AREAS.map((area) => area.group);
    expect(groups.lastIndexOf('operational')).toBeLessThan(groups.indexOf('configuration'));
  });

  it('leads with the area an operator opens the application for', () => {
    // Not alphabetisation and not an accident: D23 designs the phone rendering around one
    // action, and this is the area that answers it.
    expect(AREAS[0].segment).toBe('today');
  });

  it('splits every area into exactly one group', () => {
    expect(areasIn('operational').length + areasIn('configuration').length).toBe(AREAS.length);
  });
});

/**
 * Modules, and the two lists that must not drift.
 *
 * `MODULES` is what a business is offered and billed for; `AREAS` is what it then sees. A
 * module owning no area is a line on an invoice with no product behind it. An area owned by no
 * module is a screen nobody can switch off, which is the state the whole platform was in
 * before this — see `constraints.md` D25 and `roadmap.md` M3.
 */
describe('modules', () => {
  it('offers no module that owns nothing', () => {
    // A module owning neither an area nor a named surface outside the shell is a line on an
    // invoice with no product behind it. Booking, the portal and card payments own no sidebar
    // entry and are not orphans — they are the reason `outside` exists.
    const owned = new Set(AREAS.flatMap((area) => (area.module ? [area.module] : [])));
    const orphans = MODULES.filter((module) => !owned.has(module.key) && !('outside' in module));
    expect(orphans.map((module) => module.key)).toEqual([]);
  });

  it('names only modules that exist', () => {
    // The other direction. An area may name no module at all — that is the kernel — but an
    // area naming a key nobody sells is an entry that disappears for every business.
    const keys = new Set<string>(MODULES.map((module) => module.key));
    const dangling = AREAS.filter((area) => area.module && !keys.has(area.module));
    expect(dangling.map((area) => area.segment)).toEqual([]);
  });

  it('can actually hide something', () => {
    // **The regression this file exists for now.** The first version of `MODULES` listed the
    // kernel as four modules marked required, so every area belonged to one of them and the
    // filter below could never remove an entry — module enablement shipped inert and no test
    // noticed, because every assertion was about the two lists agreeing rather than about the
    // feature doing anything. An area owned by an optional module is what makes the switch
    // real, and `roadmap.md` M4 named the caller: an operator who does not want Assets.
    const optional = AREAS.filter((area) => area.module);
    expect(optional.length).toBeGreaterThan(0);

    const withNothingOn = [...areasIn('operational', new Set()), ...areasIn('configuration', new Set())];
    expect(withNothingOn.length).toBeLessThan(AREAS.length);
  });

  it('keeps a business inside its own settings whatever it switches off', () => {
    // Settings is where the switches are. A module that could hide its own switch would be a
    // business locked out of its account with no way back, so it belongs to the kernel and
    // names no module at all.
    const settings = AREAS.find((area) => area.segment === 'settings')!;
    expect(settings.module).toBeUndefined();
  });

  it('shows the kernel to a business that has switched everything off', () => {
    const shown = [...areasIn('operational', new Set()), ...areasIn('configuration', new Set())];

    // Nothing enabled, and the business still has work, a schedule, customers and a way back
    // into its own settings — because none of those was ever sold to it separately.
    expect(shown.every((area) => area.module === undefined)).toBe(true);
    for (const segment of ['today', 'work', 'schedule', 'customers', 'settings']) {
      expect(shown.map((area) => area.segment)).toContain(segment);
    }
    // And the two that are modules are gone. This is *not* the capability gating I12 forbids:
    // a role that cannot configure fields still sees Custom fields and is told why, whereas a
    // module the business never bought is not part of that business at all.
    expect(shown.map((area) => area.segment)).not.toContain('pricing');
    expect(shown.map((area) => area.segment)).not.toContain('assets');
  });

  it('shows an area once its module is on', () => {
    const shown = areasIn('configuration', new Set(['billing']));
    expect(shown.map((area) => area.segment)).toContain('pricing');

    // And with nothing passed, everything: a caller with no business in hand means all of it.
    expect(areasIn('operational').length + areasIn('configuration').length).toBe(AREAS.length);
  });
});
