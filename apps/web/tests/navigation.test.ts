import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AREAS,
  AREA_GROUPS,
  MODULES,
  areaHref,
  areaRootSegment,
  areasIn,
  currentSegment,
  moduleConfiguration,
  type Module,
} from '@/lib/navigation';
import { AREA_ICONS } from '@/app/organizations/[organizationId]/org-shell';

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

  it('gives every area an icon for the tablet rail (M11)', () => {
    // The rail renders icon-only between `md` and `lg` — an area with no entry here would
    // render blank rather than failing loudly.
    for (const area of AREAS) {
      expect(AREA_ICONS[area.segment], `"${area.segment}" has no rail icon`).toBeDefined();
    }
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

  it('keeps each section contiguous and in AREA_GROUPS order (D23)', () => {
    // "An operator must never reach today's work by going through settings." The order used
    // to carry that claim and nothing held it, which made it the accident D23 says a later
    // contributor would be free to tidy away. The sidebar rules between the two groups, so
    // an interleaved list would render a divider in the middle of the operational half.
    // Each section appears as one unbroken run, and the runs come in the declared order. The
    // sidebar rules between sections, so an interleaved list would draw a divider through the
    // middle of one — and D23's rule, that an operator never reaches today's work by going
    // through settings, is the first and last entries of that order.
    const order = AREA_GROUPS.map((group) => group.key);
    const runs = AREAS.map((area) => area.group).filter(
      (group, index, all) => group !== all[index - 1],
    );
    expect(runs).toEqual(order);
    expect(order[0]).toBe('operations');
    expect(order[order.length - 1]).toBe('configuration');
  });

  it('leads with the area an operator opens the application for', () => {
    // Not alphabetisation and not an accident: D23 designs the phone rendering around one
    // action, and this is the area that answers it.
    expect(AREAS[0].segment).toBe('today');
  });

  it('splits every area into exactly one group', () => {
    const total = AREA_GROUPS.reduce((sum, group) => sum + areasIn(group.key).length, 0);
    expect(total).toBe(AREAS.length);
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

    const withNothingOn = AREA_GROUPS.flatMap((group) => areasIn(group.key, new Set()));
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
    const shown = AREA_GROUPS.flatMap((group) => areasIn(group.key, new Set()));

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
    expect(AREA_GROUPS.reduce((sum, group) => sum + areasIn(group.key).length, 0)).toBe(AREAS.length);
  });
});

/**
 * Where a module is configured, and why a link is a test rather than a convention.
 *
 * **D31, and the failure it was written from.** Card payments could be switched on while the
 * section that connects an account was not rendered at all: `paymentProvider()` answers null on
 * a deployment holding no processor keys, and the whole *Getting paid* section sat behind that.
 * A business turned the switch on and its settings page said nothing. That is the same class of
 * bug as a module that hides nothing — in both, the operator believes something happened —
 * except that this one is invisible from inside the code, because every individual piece is
 * doing what it says.
 *
 * So the link is asserted from both ends, exactly as the two navigation lists already are: a
 * module must name somewhere real, and the somewhere must contain what the module claims it
 * does.
 */
describe('a switch leads to its inputs', () => {
  it('sends every module somewhere that exists', () => {
    for (const sold of MODULES) {
      const area = AREAS.find((entry) => entry.segment === sold.configuredAt.segment);
      expect(area, `module "${sold.key}" is configured at an area that does not exist`).toBeDefined();
    }
  });

  it('never sends a module through an area a second switch can hide without saying so', () => {
    // A link into an area owned by a *different* module is a dead end waiting for that other
    // module to be switched off — the same failure arriving by a longer route. The kernel is
    // always there, and a module's own area is there whenever the link is rendered.
    //
    // **One exception, and it has to be declared rather than assumed.** Weather is a module
    // whose whole expression is a rule, so it is configured inside Automations. That is
    // permitted only if the module says out loud that it needs the other one — at which point
    // the settings screen tells a business the requirement is missing, instead of handing them
    // a link that goes nowhere.
    for (const sold of MODULES as readonly Module[]) {
      const area = AREAS.find((entry) => entry.segment === sold.configuredAt.segment)!;
      if (area.module === undefined || area.module === sold.key) continue;

      expect(
        sold.requires,
        `module "${sold.key}" is configured inside "${area.module}" without declaring it needs it`,
      ).toBe(area.module);
    }
  });

  it('names only modules that exist as a requirement', () => {
    const keys = new Set<string>(MODULES.map((sold) => sold.key));
    for (const sold of MODULES as readonly Module[]) {
      if (!sold.requires) continue;
      expect(keys.has(sold.requires), `module "${sold.key}" needs one that does not exist`).toBe(
        true,
      );
      // A module needing itself would make the settings sentence nonsense and the check vacuous.
      expect(sold.requires).not.toBe(sold.key);
    }
  });

  it('names a section that the page it points at actually has', () => {
    // The anchor is a claim about a file. Renaming a section is one word and nothing else about
    // either file would look different, so the two are compared here rather than trusted.
    // Widened to `Module`, because `as const satisfies` narrows each entry to its own literal
    // shape and only some of them carry a section at all.
    for (const sold of MODULES as readonly Module[]) {
      const { segment, section } = sold.configuredAt;
      if (!section) continue;

      const source = readFileSync(`${ROUTES}/${segment}/page.tsx`, 'utf8');
      expect(source, `"${segment}" has no section id="${section}" for module "${sold.key}"`).toContain(
        `id="${section}"`,
      );
    }
  });

  it('gates the booking module’s per-type surface on the booking module', () => {
    // **A module hides what it owns everywhere, not only its own area** — the rule switching
    // `billing` off follows when it takes the quote and the invoice off every job screen.
    // Publishing a kind of work is the second half of public booking: the address is configured
    // in Settings, where `configuredAt` points, and *which types are on the page* is configured
    // per type on the Work screen. Leaving that visible with the module off would be half a
    // switch, and it is the kind of thing a refactor removes without noticing, because the
    // control still works.
    //
    // Read from source for the reason the section check above is: the alternative is trusting
    // that whoever moves this section remembers what it was conditional on.
    const work = readFileSync(`${ROUTES}/work/page.tsx`, 'utf8');

    expect(work).toContain('PublishTypeForm');
    expect(work, 'the publish section is not gated on the booking module').toMatch(
      /bookingEnabled\s*\?[\s\S]{0,400}PublishTypeForm/,
    );
    expect(work).toContain("enabledModules.has('booking')");
  });

  it('builds a link that says where it goes', () => {
    const payments = MODULES.find((sold) => sold.key === 'card_payments')!;
    const where = moduleConfiguration('org-1', payments);

    expect(where.href).toBe('/organizations/org-1/settings#getting-paid');
    // The area's own word, which is the platform noun this file owns. A link labelled
    // "configure" would be the one place in the shell where a screen invents a name.
    expect(where.label).toBe('Settings');

    const billing = MODULES.find((sold) => sold.key === 'billing')!;
    expect(moduleConfiguration('org-1', billing).href).toBe('/organizations/org-1/pricing');
    expect(moduleConfiguration('org-1', billing).label).toBe('Pricing');
  });
});
