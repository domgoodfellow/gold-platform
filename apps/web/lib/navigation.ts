/**
 * The areas of one business, and the only place the platform's own nouns are written down.
 * Concentrated here so a future per-tenant terminology override is a lookup on `label`, not an
 * excavation across nine page headings (M3). These are the platform's words, not a tenant's —
 * a business's own vocabulary is rows, read from the database wherever it appears. Nothing here
 * is capability-gated: every screen shows itself to any member and explains what their role
 * can't do, because the guard is the RLS policy and the sentence is the courtesy (I12).
 */

/**
 * Which section of the shell an area belongs to.
 *
 * **Three, and they are named for what an operator does rather than for what we bill.** The
 * source this grouping comes from (`starting_conversation.txt`) describes four layers — core
 * platform, operational engine, business modules, business configuration — and the third of them
 * cannot be a navigation section here. *Module* is the billing axis (D25): Reports, Assets,
 * Automations and Reception are all modules, so a section by that name would have to hold areas
 * that belong in all three of these. Two axes crossed in one list is how a sidebar stops making
 * sense.
 *
 * D23 still governs the part that matters: operations comes first and configuration last, and an
 * operator must never reach today's work by going through settings.
 */
export type AreaGroup = 'operations' | 'records' | 'configuration';

/**
 * The sections, in the order the sidebar draws them. One list, so the ordering rule D23 states
 * is a value the test can read rather than a sentence it has to trust.
 */
export const AREA_GROUPS = [
  { key: 'operations', label: 'Operations' },
  // Who the work is for, and what it is done to. Entities rather than activities — the things a
  // business keeps a record of and refers back to.
  { key: 'records', label: 'Records' },
  { key: 'configuration', label: 'Configuration' },
] as const satisfies readonly { key: AreaGroup; label: string }[];

/**
 * The modules this platform sells, and the only list of them — a row in `organization_modules`,
 * never a directory (D25), and never read by an RLS policy. The kernel (work, schedule,
 * customers, locations, resources, fields, roles, settings) is not a module and names none
 * below; `Area.module` is optional for that reason. Every key here has a screen behind it —
 * `starting_conversation.txt` names future modules that don't yet exist, and this list is only
 * the subset that does; `navigation.test.ts` keeps the two from drifting.
 */

/** Where inside one business a module is set up — an area, and optionally a section of that area's page. */
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
  /** The surface this module controls, when it isn't an area of the operator shell — public booking, the portal, a control on an invoice. Still a module: it's switched on and billed for either way. */
  outside?: string;
  /**
   * Where this module is configured — required of every module (D31). Answers a different
   * question from `outside`: not what the module controls, but where a business fills it in.
   * A module that's switched on with nowhere to configure it is worse than no switch at all —
   * card payments once did exactly that, rendering an empty section. The segment must be the
   * kernel or this module's own area, never a different module's, or a second switch could
   * break the link.
   */
  configuredAt: ModuleConfiguration;
  /**
   * Another module this one cannot work without — for a module whose whole expression lives
   * inside another one's surface (weather and maintenance are both rules, configured on the
   * Automations screen). Not a general nesting mechanism; `navigation.test.ts` refuses the link
   * without it and checks the name exists. Typed `string`, not `ModuleKey`, since `ModuleKey` is
   * derived from `MODULES` and a field referring to it would define the type in terms of itself.
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
    configuredAt: { segment: 'settings', section: 'public-page' },
  },
  {
    key: 'portal',
    label: 'Customer portal',
    description: 'A customer signs in by invitation and sees their own work and invoices.',
    outside: 'the customer portal, reached by an invitation this business sends',
    // No business-wide setting — an invitation is sent to one customer from their own page.
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
    // Owns no entity and no screen of its own — a weather rule *is* an automation rule.
    outside: 'a rule that reads conditions at a job’s location',
    configuredAt: { segment: 'automations' },
    requires: 'automations',
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    description:
      'Counters on machines, and rules that raise work every so many hours or miles. A business whose work is not driven by a meter runs without it.',
    outside: 'a counter on an asset, and a rule that watches it',
    configuredAt: { segment: 'automations' },
    requires: 'automations',
  },
  {
    key: 'drafting',
    label: 'Guided setup',
    description:
      'Describe the business in your own words and get a proposed setup back to read, change and apply. A business that would rather fill in each screen itself runs without it — and every one of those screens exists either way.',
    // Its own area — unlike weather and maintenance, what it produces is a document argued with over several sittings, not a section of somebody else's page.
    configuredAt: { segment: 'setup' },
  },
  {
    key: 'assistant',
    label: 'Ask',
    // The one description that says where data goes, since it's the one module that sends any.
    description:
      'Ask about this business in plain words and get an answer built from what you can already see. It reads and changes nothing. Questions, and the rows read to answer them, are sent to whichever model this installation uses — see the note on the Ask screen. A business that would rather look at the screens itself runs without it.',
    // Its own working surface — nothing to configure, so the switch leads straight to where the thing happens.
    configuredAt: { segment: 'ask' },
  },
  {
    key: 'reporting',
    label: 'Reporting',
    description:
      'What this business billed and what its work consumed, and how much work it marked finished — grouped by customer, service, resource or location. A business that reads its numbers in its accounting software runs without it.',
    configuredAt: { segment: 'reports' },
    // No `requires: 'billing'` any more — "work marked complete" reads the event log and needs no invoice, so a business that invoices elsewhere now has something to read here too.
  },
  {
    key: 'card_payments',
    label: 'Card payments',
    description: 'Ask a processor to collect what is outstanding, rather than only cash.',
    outside: 'the card control on an invoice',
    configuredAt: { segment: 'settings', section: 'getting-paid' },
  },
  {
    key: 'reception',
    label: 'Reception and sales',
    description:
      'A record of every call, the words this business uses for how one went, and the stages a relationship moves through. A business that keeps its pipeline somewhere else runs without this and keeps every customer it recorded.',
    // Dialer and pipeline are one module deliberately — a pipeline with no calls is a hand-kept list; calls with no pipeline are a log nobody reads twice.
    configuredAt: { segment: 'calls', section: 'setup' },
  },
] as const satisfies readonly Module[];

export type ModuleKey = (typeof MODULES)[number]['key'];

export function isModuleKey(value: string): value is ModuleKey {
  return MODULES.some((module) => module.key === value);
}

export type Area = {
  /** The path segment under `/organizations/[organizationId]/` — also the assertion: `navigation.test.ts` fails if a segment has no page, or a page has no segment. */
  segment: string;
  /** The platform's word for this area — used for the nav entry **and** the page's `<h1>`, so no page under `[organizationId]` carries its own heading. */
  label: string;
  /** Operational or configuration (D23). */
  group: AreaGroup;
  /** The module this area belongs to, or absent for the kernel. A business without a named module doesn't see its entry — not capability gating (I12), just a fact that it isn't part of that business. */
  module?: ModuleKey;
};

/** Operational areas first, configuration last — a claim about what an operator does all day, not an alphabetisation. */
export const AREAS: readonly Area[] = [
  // Leads because D23 says the action an operator's phone is designed around is "what do I do next".
  { segment: 'today', label: 'Today', group: 'operations' },
  { segment: 'work', label: 'Work', group: 'operations' },
  { segment: 'schedule', label: 'Schedule', group: 'operations' },
  { segment: 'resources', label: 'Resources', group: 'operations' },
  // Operational, not configuration — asking what's at risk of being late happens mid-shift, and nothing here is configured at all.
  { segment: 'ask', label: 'Ask', group: 'operations', module: 'assistant' },
  // Last in operations, on purpose — reading what a month came to is periodic, not part of the loop that gets work done.
  { segment: 'reports', label: 'Reports', group: 'operations', module: 'reporting' },

  { segment: 'customers', label: 'Customers', group: 'records' },
  // Beside Customers — the same loop from the other end: who to ring is a question about the customer list.
  { segment: 'calls', label: 'Calls', group: 'records', module: 'reception' },
  { segment: 'locations', label: 'Locations', group: 'records' },
  { segment: 'assets', label: 'Assets', group: 'records', module: 'assets' },

  // Turning this off also takes priced lines and the invoice off a job screen — see the work item route.
  { segment: 'pricing', label: 'Pricing', group: 'configuration', module: 'billing' },
  { segment: 'automations', label: 'Automations', group: 'configuration', module: 'automations' },
  { segment: 'fields', label: 'Custom fields', group: 'configuration' },
  { segment: 'roles', label: 'People and roles', group: 'configuration' },
  // Last but one — a business reaches guided setup while standing everything up and rarely again.
  { segment: 'setup', label: 'Guided setup', group: 'configuration', module: 'drafting' },
  // Names no module — it's where the switches are, so a module able to hide it would lock a business out of its own account.
  { segment: 'settings', label: 'Settings', group: 'configuration' },
] as const;

/** `enabled` is module keys, not capabilities (D25). Passing nothing shows everything. */
export function areasIn(group: AreaGroup, enabled?: ReadonlySet<string>): Area[] {
  return AREAS.filter(
    (area) =>
      area.group === group &&
      // No module named means the kernel — not something a business switched on, so not something it can switch off.
      (!area.module || !enabled || enabled.has(area.module)),
  );
}

export function areaHref(organizationId: string, segment: string): string {
  return `/organizations/${organizationId}/${segment}`;
}

/** One function rather than a separate href and label lookup — a link with the wrong word on it is the same dead end as a link to the wrong place. */
export function moduleConfiguration(
  organizationId: string,
  module: Module,
): { href: string; label: string } {
  const area = AREAS.find((entry) => entry.segment === module.configuredAt.segment);
  const anchor = module.configuredAt.section ? `#${module.configuredAt.section}` : '';

  return {
    href: `${areaHref(organizationId, module.configuredAt.segment)}${anchor}`,
    // Unreachable in a build that passes `navigation.test.ts` — here so a mistake renders as a plain word rather than throwing.
    label: area?.label ?? module.configuredAt.segment,
  };
}

/** One parser — the two questions below differ only in what they do with the depth. */
function parse(pathname: string): { segment: string; depth: number } | null {
  const parts = pathname.split(/[?#]/)[0].split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'organizations') return null;
  const segment = parts[2];
  if (!AREAS.some((area) => area.segment === segment)) return null;
  return { segment, depth: parts.length };
}

/** Which area a pathname is **in**, for the current navigation entry — a detail route counts, so reading one job still marks Work. */
export function currentSegment(pathname: string): string | null {
  return parse(pathname)?.segment ?? null;
}

/** Which area a pathname is **at**, for the shell's heading — `/work` is at Work, `/work/{id}` is only in it, since a detail screen owns its own `<h1>`. */
export function areaRootSegment(pathname: string): string | null {
  const parsed = parse(pathname);
  return parsed && parsed.depth === 3 ? parsed.segment : null;
}
