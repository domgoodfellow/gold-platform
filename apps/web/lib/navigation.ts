import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The areas of one business, and the only place the platform's own nouns are written down.
 * Concentrated here so a future per-tenant terminology override is a lookup on `label`, not an
 * excavation across nine page headings (M3). These are the platform's words, not a tenant's —
 * a business's own vocabulary is rows, read from the database wherever it appears.
 *
 * **Most of this list is still not capability-gated, and that stays deliberate (I12):** a kernel
 * or general-purpose area shows itself to any member and explains what their role can't do,
 * because the guard is the RLS policy and the sentence is the courtesy. `Area.relevantCapabilities`
 * is the narrow exception, added for a genuinely feature-specific area whose entire content is
 * behind one capability a role can lack (Reports, Automations' own settings, Integrations) — the
 * sidebar hides a link nobody assigned this role could do anything behind, but direct navigation
 * to the route is still refused server-side by RLS regardless of what the sidebar shows, exactly
 * as before this field existed.
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
  /**
   * A route nested under that area, for a module configured on one of Settings' own sub-pages
   * rather than the area's own root — Settings is the one area whose "page" is genuinely several
   * routes (`settings-navigation.tsx`), so a module configured there needs to say which.
   */
  path?: string;
  /** An `id` on the resolved page, when that page is not itself the whole of the configuration. */
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
    configuredAt: { segment: 'settings', path: 'branding', section: 'public-page' },
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
    // Configured inside Pricing's own "Getting paid" section — a card collects against an
    // invoice Billing produced, so this declares the dependency rather than leaving a link
    // pointing at an area a second switch could hide without saying so.
    configuredAt: { segment: 'pricing', section: 'getting-paid' },
    requires: 'billing',
  },
  {
    key: 'reception',
    label: 'Reception and sales',
    description:
      'A record of every call, the words this business uses for how one went, and the stages a relationship moves through. A business that keeps its pipeline somewhere else runs without this and keeps every customer it recorded.',
    // Dialer and pipeline are one module deliberately — a pipeline with no calls is a hand-kept list; calls with no pipeline are a log nobody reads twice.
    configuredAt: { segment: 'calls', section: 'setup' },
  },
  {
    key: 'integrations',
    label: 'Integrations',
    description:
      'Connect a spreadsheet or an external system and bring its customers into GOLD, once or on a schedule. A business that enters everything by hand runs without this.',
    configuredAt: { segment: 'integrations' },
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
  /**
   * Route metadata, kept apart from sidebar visibility on purpose. `false` means this area's
   * route, href, capability and module gating are all unchanged — it is still a real, directly
   * addressable page — it simply is not one of the permanent rows a business scans every day
   * (Guided setup alone, while `operationalState === 'setup'` gives it its own elevated
   * treatment instead). A product capability with its own canonical workspace — Pricing,
   * Automations, Custom fields, Team — belongs in the sidebar; Settings is one
   * organization Area among these, never a second door to one of them (`CLAUDE.md`). Absent
   * (the default) means shown, same as before this field existed.
   */
  sidebar?: boolean;
  /**
   * The area this one reads as nested under, for `AreaTrail` alone — never a second grouping
   * axis and never consulted by `areasIn`. Only relevant to an area with `sidebar: false`, which
   * still needs to say where it belongs when somebody arrives at it directly — the parent's own
   * `label` is read straight off its `Area` entry rather than inventing a second label registry.
   */
  parent?: string;
  /**
   * A role must hold at least one of these to see this area in navigation — never a substitute
   * for the module gate above, layered on top of it. Absent (the default) means every member
   * sees the area regardless of capability, which stays true for every kernel and general
   * operational area (Today, Work, Customers, Schedule, Locations, Resources, Assets, Settings).
   * Direct navigation to the route underneath is unaffected either way; RLS decides that.
   */
  relevantCapabilities?: readonly Capability[];
  /**
   * The canonical `platform_catalog_features.key` value(s) that actually back this area's
   * surface — route metadata (an identifying key, nothing copied from the catalogue itself),
   * used to resolve visibility against `organizationResolvedFeatureStates` rather than against
   * `area.module` alone. One legacy `ModuleKey` can back several canonical Features (D46's
   * many-to-many seam via `platform_catalog_runtime_mappings`), so gating on `module` alone
   * would show this area whenever *any* sibling feature sharing that module key stayed active —
   * `featureKeys` names the specific one(s) this area is actually the surface for. Absent for
   * the kernel and for an area whose module has no canonical feature mapping yet (Guided
   * setup/`drafting`) — both keep the legacy module-only gate.
   */
  featureKeys?: readonly string[];
};

/** Operational areas first, configuration last — a claim about what an operator does all day, not an alphabetisation. */
export const AREAS: readonly Area[] = [
  // Leads because D23 says the action an operator's phone is designed around is "what do I do next".
  { segment: 'today', label: 'Today', group: 'operations' },
  { segment: 'work', label: 'Work', group: 'operations' },
  { segment: 'schedule', label: 'Schedule', group: 'operations' },
  { segment: 'resources', label: 'Resources', group: 'operations' },
  // Operational, not configuration — asking what's at risk of being late happens mid-shift, and nothing here is configured at all.
  { segment: 'ask', label: 'Ask', group: 'operations', module: 'assistant', relevantCapabilities: ['assistant.ask'], featureKeys: ['ask_gold'] },
  // Last in operations, on purpose — reading what a month came to is periodic, not part of the loop that gets work done.
  { segment: 'reports', label: 'Reports', group: 'operations', module: 'reporting', relevantCapabilities: ['report.read', 'report.manage'], featureKeys: ['saved_dashboards', 'saved_reports', 'utilization'] },

  { segment: 'customers', label: 'Customers', group: 'records' },
  // Beside Customers — the same loop from the other end: who to ring is a question about the customer list.
  // The specific Communications/Voice features this surface is — not `pipeline`/`configurable_stages`/
  // `qualification_state`, which also map to the `reception` module key but back the CRM pipeline
  // (Customers), a different surface entirely (D46's many-to-many seam, and the reason `featureKeys`
  // exists rather than gating on `module` alone).
  { segment: 'calls', label: 'Calls', group: 'records', module: 'reception', relevantCapabilities: ['call.place'], featureKeys: ['inbound_calling', 'outbound_calling', 'recording', 'call_dispositions'] },
  { segment: 'locations', label: 'Locations', group: 'records' },
  { segment: 'assets', label: 'Assets', group: 'records', module: 'assets', featureKeys: ['assets'] },

  // Turning this off also takes priced lines and the invoice off a job screen — see the work item route.
  { segment: 'pricing', label: 'Pricing', group: 'configuration', module: 'billing', relevantCapabilities: ['price.manage'], featureKeys: ['price_book', 'quote_creation', 'invoices'] },
  { segment: 'automations', label: 'Automations', group: 'configuration', module: 'automations', relevantCapabilities: ['automation.manage'], featureKeys: ['rule_authoring', 'domain_event_trigger', 'email_action', 'run_history'] },
  { segment: 'fields', label: 'Custom fields', group: 'configuration', relevantCapabilities: ['field.manage'] },
  { segment: 'roles', label: 'Team', group: 'configuration', relevantCapabilities: ['role.manage'] },
  // `sidebar: false`: Business Setup is implementation infrastructure, not a permanent tenant
  // area (Product Contract, Slice 1/3). While a business is in SETUP it already has its own
  // elevated shell treatment (`SetupEntry`/`SetupBadge` in `layout.tsx`) — a second, equal-weight
  // row in the ordinary Configuration group would be the very thing that treatment exists to
  // avoid. While LIVE, the route recedes to a Settings hub card instead of the sidebar. The
  // route, its module gate and `/setup` itself are all unchanged — only where it is *found*
  // moved.
  // No `featureKeys`: no canonical Feature currently maps to `module_key = 'drafting'`
  // (`20260918000001`'s seed has no such runtime mapping) — a real gap, not an oversight, kept
  // on the legacy module-only gate rather than inventing a catalogue identifier that doesn't
  // exist yet.
  { segment: 'setup', label: 'Guided setup', group: 'configuration', module: 'drafting', sidebar: false, relevantCapabilities: ['configuration.propose'] },
  // Its own area, not folded into Settings — a business returns here often enough (checking a
  // run, adding a source) that it isn't a set-once switch the way pricing or automations config
  // is, the same reasoning that keeps Automations and Guided setup each their own area.
  { segment: 'integrations', label: 'Integrations', group: 'configuration', module: 'integrations', relevantCapabilities: ['integration.manage'], featureKeys: ['csv_import'] },
  // Names no module — it's where the switches are, so a module able to hide it would lock a business out of its own account.
  { segment: 'settings', label: 'Settings', group: 'configuration' },
] as const;

/** Whether `area` should appear in navigation for a caller with `capabilities` — the layer `areasIn`/`OrgNavBar` both apply on top of the module gate. Absent `relevantCapabilities` always passes; absent `capabilities` always passes (no gate to apply). */
export function areaVisibleTo(area: Area, capabilities?: ReadonlySet<Capability>): boolean {
  return (
    !area.relevantCapabilities ||
    !capabilities ||
    area.relevantCapabilities.some((capability) => capabilities.has(capability))
  );
}

/**
 * Whether `area` is entitled — the layer under `areaVisibleTo`'s capability check.
 *
 * An area naming `featureKeys` resolves against those specific canonical Features when a
 * resolved `featureAvailability` set is supplied — the granularity the raw module-key gate
 * cannot express, since one `ModuleKey` can back several Features and a sibling staying active
 * must not keep a *different* Feature's area visible. Everything else (the kernel, and an area
 * whose module has no canonical Feature yet) keeps the legacy `enabled.has(area.module)` gate —
 * also what a `featureKeys` area falls back to when no `featureAvailability` is supplied, so
 * every existing caller of `areasIn` that only ever passed module keys keeps working unchanged.
 */
export function areaEntitled(
  area: Area,
  enabled?: ReadonlySet<string>,
  featureAvailability?: ReadonlySet<string>,
): boolean {
  if (area.featureKeys && featureAvailability) {
    return area.featureKeys.some((key) => featureAvailability.has(key));
  }
  // No module named means the kernel — not something a business switched on, so not something it can switch off.
  return !area.module || !enabled || enabled.has(area.module);
}

/**
 * Every area visible in navigation for the given state — one predicate, so `OrgNav` (grouped)
 * and `OrgNavBar` (flat, phone) can never diverge on eligibility even though they render
 * differently (D4 of this slice). `enabled` is legacy module keys, `featureAvailability` is the
 * canonical resolver's available-and-entitled-and-active Feature keys
 * (`availableFeatureKeys(organizationResolvedFeatureStates(...))`), and `capabilities` is the
 * role-relevance layer (I12, evolved) — all three optional, and passing none shows everything a
 * business has switched on, exactly as before either of the latter two existed.
 */
export function visibleAreas(
  enabled?: ReadonlySet<string>,
  capabilities?: ReadonlySet<Capability>,
  featureAvailability?: ReadonlySet<string>,
): Area[] {
  return AREAS.filter(
    (area) =>
      area.sidebar !== false &&
      areaEntitled(area, enabled, featureAvailability) &&
      areaVisibleTo(area, capabilities),
  );
}

export function areasIn(
  group: AreaGroup,
  enabled?: ReadonlySet<string>,
  capabilities?: ReadonlySet<Capability>,
  featureAvailability?: ReadonlySet<string>,
): Area[] {
  return visibleAreas(enabled, capabilities, featureAvailability).filter((area) => area.group === group);
}

export function areaHref(organizationId: string, segment: string): string {
  return `/organizations/${organizationId}/${segment}`;
}

/**
 * "Enter this business" — the one canonical destination, for every caller whose job is switching
 * into an organization rather than linking to a specific area inside one. Today that is
 * `AREAS[0]` (Today), but callers ask for "home", not for what the first Area happens to be, so
 * that fact lives here once rather than being re-derived (`AREAS[0].segment`) at each call site.
 */
export function organizationHomeHref(organizationId: string): string {
  return areaHref(organizationId, AREAS[0].segment);
}

/** One function rather than a separate href and label lookup — a link with the wrong word on it is the same dead end as a link to the wrong place. */
export function moduleConfiguration(
  organizationId: string,
  module: Module,
): { href: string; label: string } {
  const area = AREAS.find((entry) => entry.segment === module.configuredAt.segment);
  const path = module.configuredAt.path ? `/${module.configuredAt.path}` : '';
  const anchor = module.configuredAt.section ? `#${module.configuredAt.section}` : '';

  return {
    href: `${areaHref(organizationId, module.configuredAt.segment)}${path}${anchor}`,
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
