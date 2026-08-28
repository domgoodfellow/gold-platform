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

/**
 * Which half of the shell an area belongs to.
 *
 * D23 adopts this as a decision rather than a habit: "Operational navigation is separate
 * from configuration navigation… An operator must never reach today's work by going through
 * settings." The order below already said so and nothing enforced it, which made it exactly
 * the accident that record says the next contributor would be free to tidy away.
 *
 * It has a caller in the same change: the sidebar rules between the two groups, and the
 * phone rendering puts the operational half where a thumb reaches first.
 */
export type AreaGroup = 'operational' | 'configuration';

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
  /** Operational or configuration. See `AreaGroup` — D23 makes this a decision. */
  group: AreaGroup;
};

/**
 * Operational areas first, configuration last.
 *
 * The order is a claim about what an operator does all day, not an alphabetisation. Work
 * and the schedule are the reason someone opens this application; roles and fields are
 * things they set up once and revisit rarely.
 */
export const AREAS: readonly Area[] = [
  // Today leads, because D23 says the action an operator's phone is designed around is
  // *what do I do next* — and for an owner-operator who is also the technician, that is most
  // of what running the business on this platform means.
  { segment: 'today', label: 'Today', group: 'operational' },
  { segment: 'work', label: 'Work', group: 'operational' },
  { segment: 'schedule', label: 'Schedule', group: 'operational' },
  { segment: 'customers', label: 'Customers', group: 'operational' },
  { segment: 'locations', label: 'Locations', group: 'operational' },
  { segment: 'assets', label: 'Assets', group: 'operational' },
  { segment: 'resources', label: 'Resources', group: 'operational' },
  { segment: 'pricing', label: 'Pricing', group: 'configuration' },
  { segment: 'fields', label: 'Custom fields', group: 'configuration' },
  { segment: 'roles', label: 'People and roles', group: 'configuration' },
  { segment: 'settings', label: 'Settings', group: 'configuration' },
] as const;

/** The areas of one group, in the order declared above. */
export function areasIn(group: AreaGroup): Area[] {
  return AREAS.filter((area) => area.group === group);
}

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
