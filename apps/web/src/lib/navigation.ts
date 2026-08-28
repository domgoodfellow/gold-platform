/**
 * The areas of one business, and the only place the platform's own nouns are written down.
 *
 * **Every platform noun lives here**, and the reason is not that a navigation list needs a
 * module. `constraints.md` defers per-tenant terminology overrides under "Decided, not yet
 * built" until a second vertical makes their shape knowable, and what that deferral costs
 * later is decided now, by how scattered these words are when the evidence arrives.
 * Concentrated here, an override is a lookup on `label`. Spread across nine page headings
 * and an index page's link list — which is where they were — it is an excavation. That is
 * the debt `roadmap.md` records M3 taking on, and this file is where it is kept small.
 *
 * These are the *platform's* words, not a tenant's. A business's own vocabulary — what it
 * calls its kinds of work, its statuses, its roles, its fields, its people — is rows that
 * business wrote, and is read from the database wherever it appears. The two are different
 * mechanisms; see `roadmap.md` M3 for why conflating them was a documentation bug.
 *
 * **Nothing here is capability-gated, and that is deliberate.** Every screen already shows
 * itself to any member and explains what their role cannot do ("Your role, Dispatcher,
 * cannot configure statuses here"), because the guard is the RLS policy and the sentence is
 * the courtesy. Hiding the link instead would make this file the first place in the tree
 * where the UI decides who sees what — which is exactly the shape I12 exists to say is not
 * authorization. A member who cannot configure fields can still see that fields are a thing
 * this platform has, and is told why the form is not theirs.
 */

export type Area = {
  /**
   * The path segment under `/organizations/[organizationId]/`.
   *
   * Also the assertion: `navigation.test.ts` reads the route directory and fails if a
   * segment here has no page, or a page has no segment here. A nav that silently omits an
   * area is how the back-links this replaced survived as long as they did.
   */
  segment: string;
  /**
   * The platform's word for this area — used for the navigation entry **and** as the page's
   * `<h1>`, which is why no page under `[organizationId]` carries a heading of its own any
   * more. One string in one place is what makes "every platform noun lives here" a fact
   * about the tree rather than a convention someone has to remember.
   */
  label: string;
};

/**
 * Operational areas first, configuration last.
 *
 * The order is a claim about what an operator does all day, not an alphabetisation. Work
 * and the schedule are the reason someone opens this application; roles and fields are
 * things they set up once and revisit rarely.
 */
export const AREAS: readonly Area[] = [
  { segment: 'work', label: 'Work' },
  { segment: 'schedule', label: 'Schedule' },
  { segment: 'customers', label: 'Customers' },
  { segment: 'locations', label: 'Locations' },
  { segment: 'assets', label: 'Assets' },
  { segment: 'resources', label: 'Resources' },
  { segment: 'pricing', label: 'Pricing' },
  { segment: 'fields', label: 'Custom fields' },
  { segment: 'roles', label: 'People and roles' },
  { segment: 'settings', label: 'Settings' },
] as const;

export function areaHref(organizationId: string, segment: string): string {
  return `/organizations/${organizationId}/${segment}`;
}

/**
 * The area segment a pathname names, and how deep into it the pathname goes.
 *
 * One parser, because the two questions below differ only in what they do with the depth,
 * and two regexes that had to agree would eventually not.
 */
function parse(pathname: string): { segment: string; depth: number } | null {
  const parts = pathname.split(/[?#]/)[0].split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'organizations') return null;
  const segment = parts[2];
  if (!AREAS.some((area) => area.segment === segment)) return null;
  return { segment, depth: parts.length };
}

/**
 * Which area a pathname is **in**, for marking the current navigation entry.
 *
 * A detail route counts: an operator reading one job is still in Work, and the navigation
 * should say so. Returns null on `/organizations` itself, which is outside every business
 * and belongs to no area, and on a route that is not an area — the document download
 * handler being the one that exists today.
 */
export function currentSegment(pathname: string): string | null {
  return parse(pathname)?.segment ?? null;
}

/**
 * Which area a pathname is **at**, for the shell's heading.
 *
 * `/work` is at Work; `/work/{id}` is only in it. The distinction is easy to miss and the
 * two callers genuinely need different answers: the navigation keeps Work marked while
 * somebody reads one job, and the heading must not, because a detail screen owns its own
 * `<h1>` — that job's title — and the area label above it would be a second heading, first
 * on the page, describing the wrong thing.
 */
export function areaRootSegment(pathname: string): string | null {
  const parsed = parse(pathname);
  return parsed && parsed.depth === 3 ? parsed.segment : null;
}
