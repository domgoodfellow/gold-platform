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

/**
 * The modules this platform sells, and the only list of them.
 *
 * **A module is what a tenant switches on, is billed for, and sees below** — a row in
 * `organization_modules`, never a directory (`constraints.md` D25). It is emphatically not a
 * capability: `app.has_capability` decides what a *role* may do inside a business, and this
 * decides what the business bought. Nothing here is ever read by an RLS policy.
 *
 * **Every key names areas that exist today, and no more.** `starting_conversation.txt` lists
 * Inventory, Maintenance, Dispatch and Weather as modules and they will be; none of them is a
 * screen yet, and a key nobody can switch on is a promise the billing page makes and the
 * product does not keep. `navigation.test.ts` fails on a module owning no area and on an area
 * owned by no module, which is what keeps the two lists from drifting.
 */
export type Module = {
  key: string;
  /** What a business sees on the settings screen and, eventually, on an invoice. */
  label: string;
  description: string;
  /**
   * The operational core, which cannot be switched off.
   *
   * Not every module is optional, and pretending otherwise would be dishonest rather than
   * flexible: a business with no way to record that work happened is not running on this
   * platform. `setModuleEnabled` refuses, and the settings screen shows no switch.
   */
  required?: true;
  /**
   * The surface this module controls, when it is not an area of the operator shell.
   *
   * **Not every module is a sidebar entry, and the first draft of `navigation.test.ts`
   * assumed otherwise.** Public booking is a page the operator never visits; the portal is a
   * customer's screen; card payments is a control on the invoice. Each is still something a
   * business switches on and is billed for, so each is a module — and the test's real claim is
   * that a module owns *something*, not that it owns a sidebar entry.
   */
  outside?: string;
};

export const MODULES = [
  {
    key: 'work',
    label: 'Work',
    description: 'Jobs, their types, statuses and checklists — what this business does.',
    required: true,
  },
  {
    key: 'scheduling',
    label: 'Scheduling',
    description: 'A calendar over resources, with operating hours and a buffer between jobs.',
    required: true,
  },
  {
    key: 'customers',
    label: 'Customers',
    description: 'Who the work is for, where they are, and everything that has happened.',
    required: true,
  },
  {
    key: 'billing',
    label: 'Billing',
    description: 'A price book, quotes, invoices and payments recorded by hand.',
    required: true,
  },
  {
    key: 'booking',
    label: 'Public booking',
    description:
      'A page the public can reach, where somebody with no account takes a free slot.',
    outside: 'the public page at /book/{slug}',
  },
  {
    key: 'portal',
    label: 'Customer portal',
    description: 'A customer signs in by invitation and sees their own work and invoices.',
    outside: 'the customer portal, reached by an invitation this business sends',
  },
  {
    key: 'card_payments',
    label: 'Card payments',
    description: 'Ask a processor to collect what is outstanding, rather than only cash.',
    outside: 'the card control on an invoice',
  },
] as const satisfies readonly Module[];

export type ModuleKey = (typeof MODULES)[number]['key'];

export function isModuleKey(value: string): value is ModuleKey {
  return MODULES.some((module) => module.key === value);
}

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
  /**
   * The module this area belongs to.
   *
   * A business that has not enabled that module does not see this entry, and **that is not
   * capability gating**: the paragraph above says nothing here is gated by a role, and this
   * does not change it. A member who cannot configure fields still sees Custom fields and is
   * told why the form is not theirs (I12). A module the business never bought is a different
   * fact — it is not part of that business, so there is nobody to explain it to.
   */
  module: ModuleKey;
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
  { segment: 'today', label: 'Today', group: 'operational', module: 'work' },
  { segment: 'work', label: 'Work', group: 'operational', module: 'work' },
  { segment: 'schedule', label: 'Schedule', group: 'operational', module: 'scheduling' },
  { segment: 'customers', label: 'Customers', group: 'operational', module: 'customers' },
  { segment: 'locations', label: 'Locations', group: 'operational', module: 'customers' },
  { segment: 'assets', label: 'Assets', group: 'operational', module: 'work' },
  { segment: 'resources', label: 'Resources', group: 'operational', module: 'scheduling' },
  { segment: 'pricing', label: 'Pricing', group: 'configuration', module: 'billing' },
  { segment: 'fields', label: 'Custom fields', group: 'configuration', module: 'work' },
  { segment: 'roles', label: 'People and roles', group: 'configuration', module: 'work' },
  // Settings belongs to the core because it is where a business switches the rest on and off.
  // A module that could hide its own switch would be a business locked out of its own account.
  { segment: 'settings', label: 'Settings', group: 'configuration', module: 'work' },
] as const;

/**
 * The areas of one group that this business has switched on, in the order declared above.
 *
 * `enabled` is a set of module keys, not a set of capabilities, and the difference is the one
 * D25 exists to keep visible. Passing nothing shows everything, which is what a caller with no
 * business in hand — there is none today — would mean.
 */
export function areasIn(group: AreaGroup, enabled?: ReadonlySet<string>): Area[] {
  return AREAS.filter(
    (area) => area.group === group && (!enabled || enabled.has(area.module)),
  );
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
