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
 * **The kernel is not a module, and the first version of this list said it was.** `work`,
 * `scheduling`, `customers` and `billing` were listed here marked `required: true` — a
 * contradiction in terms, because a module is by definition the part a business *chooses*.
 * That mistake was not cosmetic: every area belonged to one of those four, so the filter
 * `areasIn` applies could never remove anything, and module enablement could not change a
 * single line of the navigation. The caller `roadmap.md` M4 named for the whole feature — an
 * owner-operator who does not want *Assets* on their phone — was unreachable on the day it
 * shipped. What a business always gets is the kernel: work, the schedule, customers,
 * locations, resources, fields, roles and its own settings. Those name no module below and
 * `Area.module` is optional for exactly that reason.
 *
 * **Every key names something that exists today, and no more.** `starting_conversation.txt`
 * lists Inventory, Maintenance, Dispatch and Weather as modules and they will be; none of them
 * is a screen yet, and a key nobody can switch on is a promise the billing page makes and the
 * product does not keep. That list is the destination and this one is the subset that has code
 * behind it. `navigation.test.ts` fails on a module owning nothing and on an area naming a
 * module that does not exist, which is what keeps the two from drifting.
 */
/**
 * Where inside one business a module is set up.
 *
 * An area, and optionally a section of that area's page — `settings#getting-paid` rather than
 * a second screen nobody would find. The section is an anchor, so it is also a claim about
 * what that page contains, and `navigation.test.ts` reads the page's source to hold it.
 */
export type ModuleConfiguration = {
  /** An area segment, which must exist in `AREAS`. */
  segment: string;
  /** An `id` on that area's page, when the area is not itself the whole of the configuration. */
  section?: string;
};

export type Module = {
  key: string;
  /** What a business sees on the settings screen and, eventually, on an invoice. */
  label: string;
  description: string;
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
  /**
   * Where this module is configured, and **it is required of every module** (D31).
   *
   * `outside` above answers *what does this module control*; this answers *where does a
   * business fill it in*, and the two are different questions with different answers. Card
   * payments controls a button on an invoice and is configured in Settings; public booking
   * controls a page on the internet and is configured in Settings too, at a different section.
   *
   * **The failure this exists to end.** Card payments could be switched on while the section
   * that connects an account was hidden — `paymentProvider()` returns null on a deployment
   * holding no processor keys, and the whole section was rendered behind that. A business
   * turned the switch on and the page said nothing at all. A switch that leads nowhere is
   * worse than no switch, for the same reason a module that hides nothing is: the operator
   * believes something happened. So a module names where it is set up, the settings screen
   * links there the moment it is on, and a deployment that cannot support one yet says so
   * rather than disappearing.
   *
   * The segment must be the kernel or this module's own area. Pointing at an area belonging to
   * a *different* module would produce a link that a second switch can break — which is the
   * same class of dead end, arriving by a longer route.
   */
  configuredAt: ModuleConfiguration;
  /**
   * Another module this one cannot work without.
   *
   * **Added because `navigation.test.ts` refused a link, and it was right to.** Weather is a
   * module by D11's account — a business switches it on and is billed for it — and what it
   * configures is a *rule*, so its `configuredAt` points into the Automations area. That is a
   * link a second switch can break, which is the dead end D31 forbids arriving by a longer
   * route.
   *
   * The honest answer is not to move the link but to say the true thing: weather without
   * automations is not a smaller feature, it is nothing at all. So the dependency is declared,
   * the settings screen says so when the required module is off, and the test accepts the link
   * because the business is told rather than left at a dead end.
   *
   * This is **not** a way to nest modules generally. It is for a module whose whole expression
   * is inside another one's surface, and the test refuses the link without it.
   *
   * Typed `string` rather than `ModuleKey` for the same reason `key` is: `ModuleKey` is derived
   * from `MODULES`, so a field on `Module` referring to it would be a type defined in terms of
   * itself. `navigation.test.ts` checks it names a module that exists.
   */
  requires?: string;
};

export const MODULES = [
  {
    key: 'billing',
    label: 'Billing',
    description:
      'A price book, quotes, invoices and payments. A business that invoices somewhere else runs without this and keeps every job it recorded.',
    configuredAt: { segment: 'pricing' },
  },
  {
    key: 'assets',
    label: 'Assets',
    description:
      'The machines, vehicles and equipment a business services or tracks — including ones its customers own.',
    configuredAt: { segment: 'assets' },
  },
  {
    key: 'booking',
    label: 'Public booking',
    description:
      'A page the public can reach, where somebody with no account takes a free slot.',
    outside: 'the public page at /book/{slug}',
    // The address the page answers on is set in Settings, beside the rest of what this
    // business says about itself publicly. What is published *to* that page is a kind of
    // work, and there is no screen for that yet — which is why the readiness sentence for this
    // module says so out loud rather than leaving an operator to find the silence themselves.
    configuredAt: { segment: 'settings', section: 'public-page' },
  },
  {
    key: 'portal',
    label: 'Customer portal',
    description: 'A customer signs in by invitation and sees their own work and invoices.',
    outside: 'the customer portal, reached by an invitation this business sends',
    // Nothing about the portal is configured for the business as a whole: an invitation is
    // sent to one customer from that customer's own page, which is where this points.
    configuredAt: { segment: 'customers' },
  },
  {
    key: 'automations',
    label: 'Automations',
    description:
      'Rules this business writes: when something happens, if a job looks a certain way, do this. A business that wants everything decided by a person runs without it.',
    configuredAt: { segment: 'automations' },
  },
  {
    key: 'weather',
    label: 'Weather',
    description:
      'Conditions at a job’s location, so a rule can move work out of the rain. A business that works indoors runs without it.',
    // **No area of its own, and D11 is why**: weather owns no entity and no screen. What a
    // business configures is a rule, so the rule screen is where this is set up — and the
    // switch links there rather than to a page that would have nothing on it.
    outside: 'a rule that reads conditions at a job’s location',
    configuredAt: { segment: 'automations' },
    // A weather rule *is* an automation rule. There is no version of this that works with
    // automations switched off, and saying so is better than a link that stops working.
    requires: 'automations',
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    description:
      'Counters on machines, and rules that raise work every so many hours or miles. A business whose work is not driven by a meter runs without it.',
    // Like weather, its whole expression is a rule — so it is set up on the same screen, and it
    // says out loud that it needs the module that screen belongs to.
    outside: 'a counter on an asset, and a rule that watches it',
    configuredAt: { segment: 'automations' },
    requires: 'automations',
  },
  {
    key: 'drafting',
    label: 'Guided setup',
    description:
      'Describe the business in your own words and get a proposed setup back to read, change and apply. A business that would rather fill in each screen itself runs without it — and every one of those screens exists either way.',
    // **An area of its own, unlike weather and maintenance**, because what it produces is a
    // document a person argues with over several sittings rather than a section on somebody
    // else's page. It is the only module whose whole surface is a thing being drafted.
    configuredAt: { segment: 'setup' },
  },
  {
    key: 'assistant',
    label: 'Ask',
    // **The one module description that says where data goes, because it is the one module that
    // sends any.** Everything else in this list runs entirely inside this installation. Switching
    // this on is the moment somebody decides that questions and the rows answering them may leave
    // the database, so it is the moment they should be told — not a paragraph in a README read by
    // whoever deployed it.
    description:
      'Ask about this business in plain words and get an answer built from what you can already see. It reads and changes nothing. Questions, and the rows read to answer them, are sent to whichever model this installation uses — see the note on the Ask screen. A business that would rather look at the screens itself runs without it.',
    // **Its own working surface, which no other module's `configuredAt` points at.** There is
    // nothing to configure: no threshold, no key, no template. What the switch leads to is the
    // page where the thing happens, and if this deployment cannot answer questions that page
    // says so in the far side's own words rather than showing an empty box (D31).
    configuredAt: { segment: 'ask' },
  },
  {
    key: 'card_payments',
    label: 'Card payments',
    description: 'Ask a processor to collect what is outstanding, rather than only cash.',
    outside: 'the card control on an invoice',
    configuredAt: { segment: 'settings', section: 'getting-paid' },
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
   * The module this area belongs to, or **absent for the kernel**.
   *
   * An area with no module is one every business has — there is no version of this platform
   * where somebody records work without work, a schedule, customers or a way into their own
   * settings. Those are not switched on because they were never sold separately.
   *
   * A business that has not enabled a named module does not see its entry, and **that is not
   * capability gating**: the paragraph at the top of this file says nothing here is gated by a
   * role, and this does not change it. A member who cannot configure fields still sees Custom
   * fields and is told why the form is not theirs (I12). A module the business never bought is
   * a different fact — it is not part of that business, so there is nobody to explain it to.
   */
  module?: ModuleKey;
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
  // Operational rather than configuration, and beside the screens it answers about: asking
  // "what is at risk of being late" is something somebody does in the middle of a shift, not
  // something they set up once. Nothing is configured here at all, which makes this the first
  // module whose `configuredAt` points at its own working surface.
  { segment: 'ask', label: 'Ask', group: 'operational', module: 'assistant' },
  { segment: 'locations', label: 'Locations', group: 'operational' },
  // A clinic services nothing it can point at; a machinery company is nothing else. This is
  // the area that made the difference between kernel and module concrete enough to fix.
  { segment: 'assets', label: 'Assets', group: 'operational', module: 'assets' },
  { segment: 'resources', label: 'Resources', group: 'operational' },
  // A business that quotes and invoices in another system runs everything else here and never
  // opens this. Turning it off also takes the priced lines and the invoice off a job screen —
  // see the work item route, which reads the same set.
  { segment: 'pricing', label: 'Pricing', group: 'configuration', module: 'billing' },
  // What this business does when nobody is looking. Configuration rather than operational: a
  // rule is written once and revisited rarely, and what it *did* shows up on the job it acted
  // on, which is where an operator is already looking.
  { segment: 'automations', label: 'Automations', group: 'configuration', module: 'automations' },
  { segment: 'fields', label: 'Custom fields', group: 'configuration' },
  { segment: 'roles', label: 'People and roles', group: 'configuration' },
  // Describing the business and reading back a proposed setup. Configuration, and last in that
  // group on purpose: a business reaches it while standing everything up and rarely again, so
  // it sits below the screens it fills in rather than above them.
  { segment: 'setup', label: 'Guided setup', group: 'configuration', module: 'drafting' },
  // Settings names no module, and that is load-bearing rather than incidental: it is where the
  // switches are, so a module able to hide it would be a business locked out of its own
  // account with no way back.
  { segment: 'settings', label: 'Settings', group: 'configuration' },
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
    (area) =>
      area.group === group &&
      // No module named means the kernel, which is not something a business switched on and
      // therefore not something it can switch off.
      (!area.module || !enabled || enabled.has(area.module)),
  );
}

export function areaHref(organizationId: string, segment: string): string {
  return `/organizations/${organizationId}/${segment}`;
}

/**
 * Where to send somebody who has just switched a module on, and what to call the place.
 *
 * One function rather than a href helper and a label lookup, because a link with the wrong
 * word on it is the same dead end as a link to the wrong place — an operator who reads
 * "Pricing" and arrives at Settings has been told something untrue about their own product.
 * The label is the area's own, which is the platform noun this file already owns.
 */
export function moduleConfiguration(
  organizationId: string,
  module: Module,
): { href: string; label: string } {
  const area = AREAS.find((entry) => entry.segment === module.configuredAt.segment);
  const anchor = module.configuredAt.section ? `#${module.configuredAt.section}` : '';

  return {
    href: `${areaHref(organizationId, module.configuredAt.segment)}${anchor}`,
    // A module naming an area that does not exist is a bug `navigation.test.ts` fails on, so
    // this fallback is never reached in a build that passes. It exists so a mistake renders as
    // a plain word rather than throwing in front of an operator.
    label: area?.label ?? module.configuredAt.segment,
  };
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
