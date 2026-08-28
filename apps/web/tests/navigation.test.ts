import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AREAS, areaHref, areaRootSegment, currentSegment } from '@/lib/navigation';

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

const ROUTES = fileURLToPath(new URL('../src/app/organizations/[organizationId]', import.meta.url));

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
});
