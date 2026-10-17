import type { Capability } from '@/lib/domain/tenancy/capabilities';
import type { SettingsScopeKey } from '@/lib/route/settings';
import type { OperationalState } from '@/lib/domain/tenancy/lifecycle';

/**
 * The areas of one business, and the only place the platform's own nouns are written down.
 * Concentrated here so a future per-tenant terminology override is a lookup on `label`, not an
 * excavation across page headings. These are the platform's words, not a tenant's —
 * a business's own vocabulary is rows, read from the database wherever it appears.
 *
 * **Most of this list is still not capability-gated, and that stays deliberate:** a kernel
 * or general-purpose area shows itself to any member and explains what their role can't do,
 * because the guard is the RLS policy and the sentence is the courtesy. `Area.relevantCapabilities`
 * is the narrow exception, added for a genuinely feature-specific area whose entire content is
 * behind one capability a role can lack (Insights, Automations' own settings, Connections) — the
 * sidebar hides a link nobody assigned this role could do anything behind, but direct navigation
 * to the route is still refused server-side by RLS regardless of what the sidebar shows, exactly
 * as before this field existed.
 */

/**
 * Which section of the shell an area belongs to.
 *
 * **Named for what an operator does, never for what we bill.** *Module* is the billing axis
 * while these groups are the navigation axis. Reports, Assets, Automations and Reception are all
 * modules, so a section named for billing/module structure
 * would have to hold areas belonging to every other section. Two axes crossed in one list is how
 * a sidebar stops making sense.
 *
 * The test for a permanent row: would somebody enter this area to do ongoing work, or are they
 * configuring how another workspace behaves? Workspace concerns live under their canonical
 * Configuration owner; shared organization concerns retain Settings ownership. `Area.sidebar:
 * false` hides record/compatibility destinations without creating a second editor.
 *
 * Work comes before Settings: an operator must never reach today's work by going through
 * configuration first.
 */
export type AreaGroup = 'home' | 'library' | 'workspaces' | 'settings';

/**
 * The nine canonical operator workspaces, whether or not each has an operating surface yet. A
 * workspace is where an operator does a kind of work — never a Product, Plan, Module, Feature or
 * permission.Registered is not visible. A workspace draws a row in the sidebar only
 * when at least one page names it (`Area.workspace`) and that page is reachable to this person
 * (`projectShell`). An authenticated Home with an honest starting state is a real page,
 * even before the workspace has records. Navigation never leads to a dead placeholder, and
 * readiness is a fact about the pages, never a flag on the workspace or an entitlement.
 *
 * Plan ≠ Product ≠ Module ≠ Feature ≠ Workspace ≠ Page. No Product key is stored here: Products
 * and workspaces have a many-to-many relationship. `featureKeys` records the current capability
 * contribution used by operator previews; it is not a commercial ownership claim.
 *
 * `label` is what an operator reads; it carries no catalogue prefix because operator vocabulary
 * and catalogue identity are separate concerns. `home` names the Area that is this workspace's
 * landing page — the parent
 * row's own destination — and is absent only for a workspace with no page yet. Insights is not a
 * workspace here: it is cross-cutting, surfaced from each workspace's own Home and from a page's
 * Insights support mode, not another workspace row. Home the cross-workspace cockpit is not a
 * workspace either, and neither is Platform Administration — a separate privileged scope,
 * never a workspace of a business.
 *
 * Order is the order a customer meets them.
 */
export const WORKSPACES = [
  { key: 'crm', label: 'CRM', home: 'sales', featureKeys: ['customer_profile', 'contacts', 'relationships', 'ownership_assignment', 'pipeline', 'configurable_stages', 'qualification_state', 'follow_ups', 'booking_intake'] },
  { key: 'communications', label: 'Communications', home: 'comms', featureKeys: ['inbound_calling', 'outbound_calling', 'recording', 'call_dispositions', 'inbound_sms', 'outbound_sms', 'number_inventory', 'caller_id'] },
  { key: 'marketing', label: 'Marketing', home: 'marketing', featureKeys: [] },
  { key: 'support', label: 'Support', home: 'support', featureKeys: [] },
  { key: 'field', label: 'Work', home: 'field', featureKeys: ['resource_records', 'assignment', 'locations', 'weather_aware_dispatch', 'assets'] },
  { key: 'finance', label: 'Finance', home: 'finance', featureKeys: ['price_book', 'quote_creation', 'quote_to_invoice', 'invoices', 'invoice_history', 'card_payments', 'connected_processor', 'adjustments_credits'] },
  { key: 'automations', label: 'Automations', home: 'automations', featureKeys: ['rule_authoring', 'domain_event_trigger', 'email_action', 'run_history'] },
  { key: 'ai', label: 'AI', home: 'ai', featureKeys: ['agent_tools'] },
  { key: 'studio', label: 'Studio', home: 'studio', featureKeys: ['pages_sections', 'draft_review_publish', 'seo_metadata', 'booking', 'portal_auth', 'portal_history'] },
] as const;

export type WorkspaceKey = (typeof WORKSPACES)[number]['key'];

/**
 * The sections, in the order the sidebar draws them. One list makes the ordering rule a value
 * the test can read rather than a sentence it has to trust. `label: null` draws no
 * heading: Settings is one row set apart by the rule above it, and a heading repeating its only
 * entry would say the word twice.
 */
export const AREA_GROUPS = [
  // Home is one row set apart, and the answer to "what matters right now".
  { key: 'home', label: null },
  // Shared organization infrastructure — never a workspace, and separate from where an
  // operator does a kind of work. One row today, like Home; no heading for the
  // same reason Home draws none.
  { key: 'library', label: null },
  // Where an operator does a kind of work: each row is a workspace, and a workspace with several
  // pages opens a dedicated sidebar context derived from `Area.workspace`.
  { key: 'workspaces', label: 'Workspaces' },
  { key: 'settings', label: null },
] as const satisfies readonly { key: AreaGroup; label: string | null }[];

/**
 * The modules this platform sells, and the only list of them — a row in `organization_modules`,
 * never a navigation directory and never read by an RLS policy. The kernel (work, schedule,
 * customers, locations, resources, fields, roles, settings) is not a module and names none
 * below; `Area.module` is optional for that reason. Every key here has a real product surface;
 * `navigation.test.ts` keeps the declared destinations from drifting from the application.
 */

/** Where inside one business a module is set up — an area, and optionally a section of that area's page. */
export type ModuleConfiguration = {
  /** An area segment, which must exist in `AREAS`. */
  segment: string;
  /**
   * A route nested under that area, for a module configured on one of Settings' own sub-pages
   * rather than the area's own root — Settings is the one area whose "page" is genuinely several
   * routes, so a module configured there needs to say which.
   */
  path?: string;
  /** User-facing destination when a module is configured on a named Settings child page. */
  label?: string;
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
   * Where this module is configured — required of every module. Answers a different
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
    configuredAt: { segment: 'finance', path: 'configuration/pricing', label: 'Pricing' },
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
    configuredAt: { segment: 'settings', path: 'domains', section: 'booking-address' },
  },
  {
    key: 'portal',
    label: 'Customer portal',
    description: 'A customer signs in by invitation and sees their own work and invoices.',
    outside: 'the customer portal, reached by an invitation this business sends',
    // Studio owns business-wide composition; Customer detail owns per-customer invitations.
    configuredAt: { segment: 'studio-portal' },
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
    // An optional accelerator *inside* Setup, which is kernel. It owns no area: the Setup lifecycle (readiness, areas, launch, review) exists whether or not this is entitled.
    outside: 'the Agent-assisted drafting section of Setup',
    configuredAt: { segment: 'setup' },
  },
  {
    key: 'assistant',
    label: 'Agent',
    // The one description that says where data goes, since it's the one module that sends any.
    description:
      'Ask the Agent about this business in plain words, from any screen, and get an answer built from what you can already see. It reads and changes nothing until a person approves a proposed action. Questions, and the rows read to answer them, are sent to whichever model this installation uses. A business that would rather look at the screens itself runs without it.',
    outside: 'the Agent, opened from any workspace',
    // The Agent is a rail on every workspace, not an area — nothing to configure, so the switch leads to the features list where it is turned on.
    configuredAt: { segment: 'settings', path: 'features' },
  },
  {
    key: 'reporting',
    label: 'Reporting',
    description:
      'What this business billed and what its work consumed, and how much work it marked finished — grouped by customer, service, resource or location. A business that reads its numbers in its accounting software runs without it.',
    configuredAt: { segment: 'insights' },
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
    configuredAt: { segment: 'finance', path: 'configuration/pricing', section: 'getting-paid', label: 'Pricing' },
    requires: 'billing',
  },
  {
    key: 'reception',
    label: 'Reception and sales',
    description:
      'A record of every call, the words this business uses for how one went, and the stages a relationship moves through. A business that keeps its pipeline somewhere else runs without this and keeps every customer it recorded.',
    // Dialer and pipeline are one module deliberately — a pipeline with no calls is a hand-kept list; calls with no pipeline are a log nobody reads twice.
    // `ModuleConfiguration` names one destination; this module truthfully has two (Communications'
    // `call-setup` and CRM's `sales-stages`, split from the single combined Settings entry they
    // used to share). Pointed at the larger of the two rather than widened to carry both — a
    // follow-up architecture issue, not solved here.
    configuredAt: { segment: 'comms', path: 'configuration/calling', label: 'Call setup' },
  },
  {
    key: 'integrations',
    label: 'Connections',
    description:
      'Connect GildOps to the apps and files a business already uses, and bring their data in. A business that enters everything by hand runs without this.',
    configuredAt: { segment: 'settings', path: 'connections', label: 'Connections' },
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
  /** Which sidebar section. */
  group: AreaGroup;
  /**
   * The workspace that **owns** this area (`WORKSPACES`). An owned page with a sidebar row is drawn
   * beneath its workspace, never as a peer of it, and a workspace with one page is a plain row.
   * An owned page with `sidebar: false` (Pricing, owned by Finance) has an owner and no row: it is
   * reached from the Settings map. Home and the cross-cutting configuration areas (Custom fields,
   * Team, Connections, Setup, Settings) belong to none. The route does not change to say which
   * workspace owns a page: `/work` is still `/work`.
   */
  workspace?: WorkspaceKey;
  /**
   * Where the page lives beneath the organization when that is not just its `segment` — a page of a
   * larger route (`customers/pipeline`). `segment` stays the unique key, the icon key and the name
   * `areaLabel` reads; the first path part is the directory `navigation.test.ts` finds the page in.
   */
  route?: string;
  /** The module this area belongs to, or absent for the kernel. A business without a named module doesn't see its entry — not capability gating (I12), just a fact that it isn't part of that business. */
  module?: ModuleKey;
  /**
   * Route metadata, kept apart from sidebar visibility on purpose. `false` means this area's
   * route, href, capability and module gating are all unchanged — it is still a real, directly
   * addressable page — it simply is not one of the permanent rows a business scans every day
   * (Guided setup alone, while `operationalState === 'setup'` gives it its own elevated
   * treatment instead). A configuration-only area — Pricing, Custom fields, Team,
   * Connections, Setup — is reached from the Settings map rather than holding a permanent row;
   * a genuine workspace belongs in the sidebar. Absent (the default) means shown.
   */
  sidebar?: boolean;
  /**
   * A role must hold at least one of these to see this area in navigation — never a substitute
   * for the module gate above, layered on top of it. Absent (the default) means every member
   * sees the area regardless of capability, which stays true for every kernel and general
   * operational area (Home, Work, Customers, Schedule, Locations, Resources, Assets, Settings).
   * Direct navigation to the route underneath is unaffected either way; RLS decides that.
   */
  relevantCapabilities?: readonly Capability[];
  /**
   * The area only makes sense for a business that has declared some kind of work as scheduled
   * (`hasSchedulableWork`). Business shape, not entitlement and not permission: it is a third,
   * independent reason an area may be absent, and never read from row counts or from whether
   * public booking is on. Absent means the area does not depend on it. Like every navigation gate
   * it hides a row and nothing else — the route underneath still answers, and RLS decides access.
   */
  needsSchedulableWork?: boolean;
  /**
   * The canonical `platform_catalog_features.key` value(s) that actually back this area's
   * surface — route metadata (an identifying key, nothing copied from the catalogue itself),
   * used to resolve visibility against `organizationResolvedFeatureStates` rather than against
   * `area.module` alone. One legacy `ModuleKey` can back several canonical Features through
   * `platform_catalog_runtime_mappings`, so gating on `module` alone
   * would show this area whenever *any* sibling feature sharing that module key stayed active —
   * `featureKeys` names the specific one(s) this area is actually the surface for. Absent for
   * the kernel and for an area whose module has no canonical feature mapping yet (Guided
   * setup/`drafting`) — both keep the legacy module-only gate.
   */
  featureKeys?: readonly string[];
};

/**
 * Home first, Settings last — a claim about what an operator does all day, not an alphabetisation.
 *
 * **Operator workspaces are not the commercial catalogue.** A row here is a place somebody works;
 * a Plan grants Features that may compose into several rows, and one row may compose Features from
 * several catalogue Modules. Nothing here is one-to-one with a Product.
 */
export const AREAS: readonly Area[] = [
  // Home leads because the operator should reach current work before configuration.
  { segment: 'home', label: 'Home', group: 'home' },

  // Library: shared organization infrastructure, never a workspace. Kernel, like Home — every
  // business has it, so it names no module.
  // Its own internal destinations (Files, Media, Templates, Knowledge, Collections, Sources,
  // Trash) are reached from Library's own page, not a second permanent sidebar.
  { segment: 'library', label: 'Library', group: 'library' },
  { segment: 'organization-calendar-legacy', label: 'Calendar (legacy organization link)', group: 'library', route: 'calendar', sidebar: false },

  // Sales. Home is the workspace's own parent destination — kernel, like Customers, so the row is
  // always there — and is never repeated as a child beneath it. Pipeline is the CRM stages view,
  // offered where the business has it (the reception module).
  { segment: 'sales', label: 'CRM', group: 'workspaces', workspace: 'crm' },
  ...WORKSPACES.filter(workspace => !['crm', 'field'].includes(workspace.key)).map(workspace => ({ segment: `${workspace.key}-calendar`, label: `${workspace.label} calendar`, group: 'workspaces' as const, workspace: workspace.key, route: `${workspace.home}/calendar`, sidebar: false })),
  { segment: 'calendar', label: 'Calendar', group: 'workspaces', workspace: 'crm', route: 'sales/calendar', sidebar: false },
  { segment: 'follow-up-calendar', label: 'Calendar (legacy link)', group: 'workspaces', workspace: 'crm', route: 'follow-ups/calendar', sidebar: false },
  { segment: 'customers', label: 'Customers', group: 'workspaces', workspace: 'crm' },
  { segment: 'pipeline', label: 'Relationship pipeline', group: 'workspaces', workspace: 'crm', route: 'customers/pipeline', module: 'reception', featureKeys: ['pipeline', 'configurable_stages', 'qualification_state'] },
  { segment: 'opportunities', label: 'Opportunities', group: 'workspaces', workspace: 'crm', sidebar: false },
  { segment: 'opportunity-pipeline', label: 'Opportunity pipeline', group: 'workspaces', workspace: 'crm', route: 'opportunities/pipeline', sidebar: false },
  { segment: 'follow-ups', label: 'Follow-ups', group: 'workspaces', workspace: 'crm', sidebar: false, featureKeys: ['follow_ups'] },
  { segment: 'crm-search', label: 'Search CRM', group: 'workspaces', workspace: 'crm', route: 'sales/search', sidebar: false },
  // Communications. Home is the workspace's own destination, so it is offered to anyone who can
  // operate **any** of its channels — placing calls (`call.place`) or sending texts
  // (`message.send`), two independent authorities — and entitled through either channel's
  // Features. Calls requires calling alone and Messages requires messaging alone, so a person who
  // only texts is never shown a calling surface, and the reverse. Numbers serve both channels and
  // is offered to either. Not the pipeline features that share the `reception` module key; that
  // many-to-many relationship is why `featureKeys` exists rather than gating on `module` alone. Messages and Numbers
  // are the domain-facing shells for SMS and the number inventory: each names the canonical
  // catalogue Features it is actually the surface for, so a deployment where those Features are
  // still `planned` in the catalogue (SMS today) shows the page and says so truthfully rather
  // than riding along on the `reception` module the way an unqualified module gate would.
  { segment: 'comms', label: 'Communications', group: 'workspaces', workspace: 'communications', module: 'reception', relevantCapabilities: ['call.place', 'message.send'], featureKeys: ['inbound_calling', 'outbound_calling', 'recording', 'call_dispositions', 'inbound_sms', 'outbound_sms', 'sending'] },
  { segment: 'calls', label: 'Calls', group: 'workspaces', workspace: 'communications', module: 'reception', relevantCapabilities: ['call.place'], featureKeys: ['inbound_calling', 'outbound_calling', 'recording', 'call_dispositions'] },
  // Inbox: one list of every asynchronous conversation, SMS and email together, and the one screen a conversation opens in. It replaced
  // the separate Text messages and Email pages (their old addresses redirect here, filtered). Gated by the sending authority (`message.send`)
  // and by either channel's Features: a business with only one of the two channels still has its Inbox.
  { segment: 'comms-inbox', label: 'Inbox', group: 'workspaces', workspace: 'communications', route: 'comms/inbox', module: 'reception', relevantCapabilities: ['message.send'], featureKeys: ['inbound_sms', 'outbound_sms', 'sending'] },
  { segment: 'comms-numbers', label: 'Numbers', group: 'workspaces', workspace: 'communications', route: 'comms/configuration/numbers', sidebar: false, module: 'reception', relevantCapabilities: ['call.place', 'message.send'], featureKeys: ['number_inventory', 'caller_id'] },
  { segment: 'marketing', label: 'Marketing', group: 'workspaces', workspace: 'marketing', relevantCapabilities: ['marketing.read', 'marketing.manage'] },
  { segment: 'support', label: 'Support', group: 'workspaces', workspace: 'support', relevantCapabilities: ['support.read'] },
  { segment: 'ai', label: 'AI', group: 'workspaces', workspace: 'ai' },
  // Finance: how this business prices, bills, gets paid and understands what its work earns —
  // tenant Financial Operations, customer to business, and nothing a business pays GildOps (that is
  // Settings → Plan & usage, and Platform for GildOps' own control plane). Home is kernel, like
  // Sales and Field's own; Quotes, Invoices and Payments are its operating pages and sit behind the
  // billing module as Pricing does. Pricing stays a Settings-only configuration target it owns
  // without drawing a sidebar row of its own.
  { segment: 'finance', label: 'Finance', group: 'workspaces', workspace: 'finance' },
  { segment: 'finance-quotes', label: 'Quotes', group: 'workspaces', workspace: 'finance', route: 'finance/quotes', module: 'billing', featureKeys: ['quote_creation'] },
  { segment: 'finance-invoices', label: 'Invoices', group: 'workspaces', workspace: 'finance', route: 'finance/invoices', module: 'billing', featureKeys: ['invoices', 'invoice_history'] },
  { segment: 'finance-payments', label: 'Payments', group: 'workspaces', workspace: 'finance', route: 'finance/payments', module: 'billing', featureKeys: ['invoices', 'card_payments'] },
  // Automations: building, reviewing and observing rules is ongoing work, so it is a workspace.
  // Home carries Rules' own entitlement, so the workspace draws no row for a business without it.
  // Rules, Messages and Activity are three pages of it, each its own route — the sidebar is the
  // one navigation for them, and no page carries a second tab strip over the same three.
  { segment: 'automations', label: 'Automations', group: 'workspaces', workspace: 'automations', module: 'automations', relevantCapabilities: ['automation.manage'], featureKeys: ['rule_authoring', 'domain_event_trigger', 'email_action', 'run_history'] },
  { segment: 'automation-rules', label: 'Rules', group: 'workspaces', workspace: 'automations', route: 'automations/rules', module: 'automations', relevantCapabilities: ['automation.manage'], featureKeys: ['rule_authoring', 'domain_event_trigger', 'email_action', 'run_history'] },
  { segment: 'automation-messages', label: 'Messages', group: 'workspaces', workspace: 'automations', route: 'automations/messages', module: 'automations', relevantCapabilities: ['automation.manage'], featureKeys: ['rule_authoring', 'domain_event_trigger', 'email_action', 'run_history'] },
  { segment: 'automation-activity', label: 'Activity', group: 'workspaces', workspace: 'automations', route: 'automations/activity', module: 'automations', relevantCapabilities: ['automation.manage'], featureKeys: ['rule_authoring', 'domain_event_trigger', 'email_action', 'run_history'] },
  // Field: what work is being done, where, when and with what. Home is a real page — kernel, like
  // Work and Schedule — and is never repeated as a child beneath it. Equipment & Assets is the one
  // page behind a module.
  { segment: 'field', label: 'Work', group: 'workspaces', workspace: 'field' },
  { segment: 'work', label: 'Work items', group: 'workspaces', workspace: 'field' },
  { segment: 'work-calendar', label: 'Work calendar', group: 'workspaces', workspace: 'field', route: 'field/calendar', sidebar: false },
  { segment: 'schedule', label: 'Schedule', group: 'workspaces', workspace: 'field', needsSchedulableWork: true },
  { segment: 'resources', label: 'Resources', group: 'workspaces', workspace: 'field', needsSchedulableWork: true },
  { segment: 'locations', label: 'Locations', group: 'workspaces', workspace: 'field', needsSchedulableWork: true },
  { segment: 'assets', label: 'Equipment & Assets', group: 'workspaces', workspace: 'field', module: 'assets', featureKeys: ['assets'] },
  // Studio: what is public for this business, and what needs attention. Home is a real page —
  // kernel, like Sales and Field's own Home, so a member sees it regardless of role. Website, Forms
  // and Templates have each earned an operating page, listed beneath it; Brand and Portal remain
  // configuration reached from Settings (`CONFIG_TARGETS`) until each earns an operating page.
  { segment: 'studio', label: 'Studio', group: 'workspaces', workspace: 'studio' },
  // Website, Forms and Templates are Studio's mature operating pages: children of the one Studio
  // workspace, shown under its expandable row like Automations' own. Studio's row is Home and is
  // never repeated as a child. Editor-internal concepts (structure, canvas, inspector) stay out of
  // the sidebar; Pages, Navigation or Theme join only once the Website composition work decides
  // whether each is a route or a view inside the editor.
  { segment: 'studio-website', label: 'Website', group: 'workspaces', workspace: 'studio', route: 'studio/website', relevantCapabilities: ['organization.manage'] },
  { segment: 'studio-portal', label: 'Customer portal', group: 'workspaces', workspace: 'studio', route: 'studio/portal', relevantCapabilities: ['organization.manage'] },
  { segment: 'studio-forms', label: 'Forms', group: 'workspaces', workspace: 'studio', route: 'studio/forms', relevantCapabilities: ['organization.manage'] },
  { segment: 'studio-templates', label: 'Templates', group: 'workspaces', workspace: 'studio', route: 'studio/templates', relevantCapabilities: ['organization.manage'] },

  // Insights: dashboards and reports over the one reporting aggregate every workspace reads. Not a
  // workspace of its own — no permanent sidebar row — but still a real, directly addressable
  // route, read from each workspace's own Home and from a page's Insights support mode.
  { segment: 'insights', label: 'Insights', group: 'workspaces', sidebar: false, module: 'reporting', relevantCapabilities: ['report.read', 'report.manage'], featureKeys: ['saved_dashboards', 'saved_reports', 'utilization'] },

  // Configuration, not places somebody works: each is a real, directly addressable route with its
  // module and capability gating unchanged, found from the Settings map (`sidebar: false`).
  // Turning Pricing off also takes priced lines and the invoice off a job screen — see the work item route.
  // Owned by Finance, whose Home links here for configuration rather than repeating it.
  { segment: 'pricing', label: 'Pricing', group: 'settings', workspace: 'finance', module: 'billing', sidebar: false, relevantCapabilities: ['price.manage'], featureKeys: ['price_book', 'quote_creation', 'invoices'] },
  { segment: 'fields', label: 'Custom fields', group: 'settings', sidebar: false, relevantCapabilities: ['field.manage'] },
  { segment: 'roles', label: 'Team', group: 'settings', sidebar: false, relevantCapabilities: ['role.manage'] },
  // Product help for operators, opened from the account menu. Not a workspace and not the Support workspace.
  { segment: 'help', label: 'Help & documentation', group: 'settings', sidebar: false },
  // Setup is a lifecycle, not a permanent area: while SETUP lasts it is the one row `SetupEntry`
  // draws above the areas, and once LIVE it recedes to the Settings map's "Setup & launch". It is
  // **kernel** — readiness, areas, launch and review exist for every business. Agent-assisted
  // drafting is an optional section inside it (`drafting` module), never a condition of reaching it.
  { segment: 'setup', label: 'Setup', group: 'settings', sidebar: false },
  // A business returns here to check a run or add a source, but connecting is configuring how
  // other workspaces get their data — so it is reached from Settings' Connections section.
  { segment: 'integrations', label: 'Connections', group: 'settings', module: 'integrations', sidebar: false, relevantCapabilities: ['integration.manage'], featureKeys: ['app_connections', 'file_imports', 'data_mapping', 'scheduled_sync', 'triggers_actions', 'agent_tools'] },
  // Names no module — it's where the switches are, so a module able to hide it would lock a business out of its own account.
  { segment: 'settings', label: 'Settings', group: 'settings' },
] as const;

/**
 * A place a business is **configured**, as opposed to a place it is **operated**.
 *
 * The two are different questions with different answers. Operating Calls takes `call.place`;
 * configuring what a call's outcome is called takes `field.manage`. A person may hold either
 * without the other, so a configuration entry must never inherit its workspace's
 * `relevantCapabilities` — it declares its own `permission`, and borrows only the workspace's
 * *entitlement* (`entitledBy`, an area segment whose module/feature gate says the business has the
 * thing at all). One definition per target: the Settings map, the Business navigation and the
 * Setup areas all read the path and the two requirements from here rather than restating them.
 */
export type ConfigTarget = {
  /** Settings scope that owns this configuration, independent of workspace entitlement. */
  scope: SettingsScopeKey;
  /** Operating editors and shared organization owners may be linked, never relocated by configuration. */
  treatment?: 'operating' | 'shared';
  key: string;
  /** The workspace whose behaviour this configures, when it is one workspace's (`WORKSPACES`); absent for the organization as a whole. */
  workspace?: WorkspaceKey;
  /** Path under `/organizations/{id}` — a route that exists, checked by `settings-map.test.ts`. */
  path: string;
  /** The area whose module/feature entitlement this needs. Absent means kernel: every business has it. */
  entitledBy?: string;
  featureKeys?: readonly string[];
  /** Holding **any** of these lets a member configure it. Never empty — a target nobody may configure is a dead door. */
  permission: readonly Capability[];
  /** Additional capabilities required by an existing domain read or command. */
  requiresAll?: readonly Capability[];
  /**
   * `false` marks a door that belongs to its workspace and is reached from that workspace's
   * Configure control (`WORKSPACE_CONFIGURE`), not listed in the Settings directory. It is still
   * one registered destination: same path, same entitlement and permission gate.
   */
  directory?: false;
};

export const CONFIG_TARGETS: readonly ConfigTarget[] = [
  { key: 'general', scope: 'organization', path: 'settings/general', permission: ['organization.manage'] },
  { key: 'resources', treatment: 'operating', scope: 'organization', workspace: 'field', path: 'resources', entitledBy: 'resources', permission: ['resource.create', 'resource.update'] },
  { key: 'locations', treatment: 'operating', scope: 'organization', workspace: 'field', path: 'locations', entitledBy: 'locations', permission: ['location.create'] },
  { key: 'website', treatment: 'operating', scope: 'organization', workspace: 'studio', path: 'studio/website', permission: ['organization.manage'] },
  { key: 'automation-rules', treatment: 'operating', scope: 'organization', workspace: 'automations', path: 'automations/rules', entitledBy: 'automations', permission: ['automation.manage'] },
  { key: 'ai-agents', scope: 'organization', workspace: 'ai', path: 'ai/agents', featureKeys: ['agent_tools'], permission: ['organization.manage'] },
  { key: 'work-configuration', scope: 'organization', workspace: 'field', path: 'work/configuration', permission: ['field.manage'] },
  { key: 'schedule-configuration', scope: 'organization', workspace: 'field', path: 'schedule/configuration', entitledBy: 'schedule', permission: ['field.manage'] },
  { key: 'pricing', scope: 'organization', workspace: 'finance', path: 'finance/configuration/pricing', entitledBy: 'pricing', permission: ['price.manage', 'organization.manage'] },
  { key: 'customer-fields', scope: 'organization', workspace: 'crm', path: 'sales/configuration/fields', permission: ['field.manage'], directory: false },
  { key: 'custom-fields', treatment: 'shared', scope: 'organization', path: 'settings/custom-fields', permission: ['field.manage'] },
  // Entitled through Pipeline, permitted through field.manage: naming stages is not moving a customer between them.
  { key: 'sales-stages', scope: 'organization', workspace: 'crm', path: 'sales/configuration/relationship-stages', entitledBy: 'pipeline', permission: ['field.manage'] },
  { key: 'opportunity-stages', scope: 'organization', workspace: 'crm', path: 'sales/configuration/opportunity-stages', entitledBy: 'opportunity-pipeline', permission: ['field.manage'] },
  // Entitled through Calls, permitted through field.manage: configuring outcomes and routing is not making calls.
  // A dedicated settings route, never `calls#setup` — a fragment into an operational page is not a canonical destination.
  { key: 'call-setup', scope: 'organization', workspace: 'communications', path: 'comms/configuration/calling', entitledBy: 'calls', permission: ['field.manage', 'organization.manage'] },
  { key: 'team', scope: 'access', path: 'settings/access', permission: ['role.manage'] },
  { key: 'branding', treatment: 'shared', scope: 'organization', workspace: 'studio', path: 'settings/branding', permission: ['organization.manage'] },
  { key: 'public-profile', treatment: 'shared', scope: 'organization', workspace: 'studio', path: 'settings/public-profile', permission: ['organization.manage'] },
  { key: 'domains', treatment: 'shared', scope: 'organization', workspace: 'studio', path: 'settings/domains', permission: ['organization.manage'] },
  { key: 'communications', scope: 'organization', workspace: 'communications', path: 'comms/configuration/messaging', permission: ['organization.manage'] },
  // Proving a sending domain is infrastructure readiness, not a Communications operating act, so
  // it is `organization.manage` like Domains rather than a messaging capability — and it is its
  // own destination rather than a block inside Communications, because a lifecycle with DNS
  // records, a review step and a verification check is not a field on somebody else's page.
  { key: 'email', scope: 'organization', workspace: 'communications', path: 'comms/configuration/email', permission: ['organization.manage'] },
  { key: 'integrations', scope: 'connections', path: 'settings/connections', entitledBy: 'integrations', permission: ['integration.manage'] },
  // Its own permission and no entitlement: handing over a private value is not connecting an app, and a business that has switched integrations off still owns what it stored.
  { key: 'secrets', scope: 'connections', path: 'settings/secrets', permission: ['secret.manage'] },
  { key: 'features', scope: 'organization', path: 'settings/features', permission: ['feature.manage'] },
  { key: 'plan', scope: 'plan', path: 'settings/plan', permission: ['billing.manage'] },
  // Workspace-owned doors: reached from their workspace's Configure control, not listed in the Settings directory.
  { key: 'phone-numbers', scope: 'organization', workspace: 'communications', path: 'comms/configuration/numbers', entitledBy: 'calls', permission: ['organization.manage'], directory: false },
  { key: 'forms', treatment: 'operating', scope: 'organization', workspace: 'studio', path: 'studio/forms', permission: ['organization.manage'], directory: false },
  { key: 'support-queues', scope: 'organization', workspace: 'support', path: 'support/configuration/queues', permission: ['support.configure'], requiresAll: ['support.read'], directory: false },
  { key: 'support-service-levels', scope: 'organization', workspace: 'support', path: 'support/configuration/service-levels', permission: ['support.configure'], requiresAll: ['support.read'], directory: false },
  { key: 'automation-messages', treatment: 'operating', scope: 'organization', workspace: 'automations', path: 'automations/messages', entitledBy: 'automations', permission: ['automation.manage'], directory: false },
  { key: 'ai-deployments', scope: 'organization', workspace: 'ai', path: 'ai/deployments', featureKeys: ['agent_tools'], permission: ['organization.manage'], directory: false },
  { key: 'ai-knowledge', scope: 'organization', workspace: 'ai', path: 'ai/knowledge', featureKeys: ['agent_tools'], permission: ['organization.manage'], directory: false },
  { key: 'ai-tools', scope: 'organization', workspace: 'ai', path: 'ai/tools', featureKeys: ['agent_tools'], permission: ['organization.manage'], directory: false },
  // Setup is kernel. Launching is `organization.manage`; asking for a drafted setup is
  // `configuration.propose`; either makes the lifecycle worth entering. No module gate: the
  // optional drafting section decides for itself whether to draw.
  { key: 'setup', scope: 'organization', path: 'setup', permission: ['organization.manage', 'configuration.propose'] },
];

export type ConfigGate = {
  enabledModules?: ReadonlySet<string>;
  featureAvailability?: ReadonlySet<string>;
  capabilities?: ReadonlySet<Capability>;
  /** `hasSchedulableWork`. Absent means unknown, which shows everything, like the other gates. */
  schedulableWork?: boolean;
};

export function configTarget(key: string): ConfigTarget {
  const target = CONFIG_TARGETS.find((candidate) => candidate.key === key);
  if (!target) throw new Error(`No configuration target has the key "${key}".`);
  return target;
}

/** Feature configuration uses the same destination keys as the organization directory. */
export const FEATURE_CONFIG_TARGETS: Readonly<Record<string, string>> = {
  pipeline: 'sales-stages', configurable_stages: 'sales-stages', qualification_state: 'sales-stages',
  inbound_calling: 'communications', outbound_calling: 'communications', recording: 'call-setup', call_dispositions: 'call-setup',
  price_book: 'pricing', card_payments: 'pricing', connected_processor: 'pricing',
  resource_records: 'resources', locations: 'locations',
  pages_sections: 'website', draft_review_publish: 'website', seo_metadata: 'website',
  rule_authoring: 'automation-rules', domain_event_trigger: 'automation-rules', email_action: 'automation-rules',
  agent_tools: 'ai-agents',
};

export function featureConfigurationTarget(featureKey: string): ConfigTarget | undefined {
  const key = FEATURE_CONFIG_TARGETS[featureKey];
  return key ? configTarget(key) : undefined;
}

/**
 * Whether a member may be offered a configuration target: the business is entitled to what it
 * configures **and** the member holds a configuration permission for it. Both, never either — a
 * broad role does not conjure an entitlement, and an entitlement does not conjure a permission.
 */
export function configTargetOffered(target: ConfigTarget, gate: ConfigGate): boolean {
  if (target.featureKeys && gate.featureAvailability && !target.featureKeys.some((key) => gate.featureAvailability!.has(key))) return false;
  if (target.entitledBy) {
    const area = AREAS.find((candidate) => candidate.segment === target.entitledBy);
    if (!area || !areaEntitled(area, gate.enabledModules, gate.featureAvailability)) return false;
    if (!areaRelevantToShape(area, gate.schedulableWork)) return false;
  }
  return !gate.capabilities || (target.permission.some((capability) => gate.capabilities!.has(capability)) && (target.requiresAll ?? []).every(capability => gate.capabilities!.has(capability)));
}

/** Whether `area` should appear in navigation for a caller with `capabilities` — the layer `areasIn`/`OrgNavBar` both apply on top of the module gate. Absent `relevantCapabilities` always passes; absent `capabilities` always passes (no gate to apply). */
export function areaVisibleTo(area: Area, capabilities?: ReadonlySet<Capability>): boolean {
  return (
    !area.relevantCapabilities ||
    !capabilities ||
    area.relevantCapabilities.some((capability) => capabilities.has(capability))
  );
}

/**
 * Whether the business's declared shape of work makes `area` meaningful. `schedulableWork` is the
 * one canonical answer (`hasSchedulableWork`); `undefined` means the caller did not ask, and an
 * unasked question hides nothing.
 */
export function areaRelevantToShape(area: Area, schedulableWork?: boolean): boolean {
  return !area.needsSchedulableWork || schedulableWork !== false;
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
 * Whether the named workspace is entitled to this organization and relevant to this role — the two
 * predicates navigation applies, asked by a caller that is not drawing navigation (Home deciding
 * which blocks exist, a workspace deciding whether to offer its Insights). One predicate, so a
 * block and its sidebar row cannot disagree about whether a business has the thing.
 */
export function areaAvailable(
  segment: string,
  state: {
    enabled?: ReadonlySet<string>;
    capabilities?: ReadonlySet<Capability>;
    featureAvailability?: ReadonlySet<string>;
    schedulableWork?: boolean;
  },
): boolean {
  const area = AREAS.find((candidate) => candidate.segment === segment);
  if (!area) throw new Error(`No area has the segment "${segment}".`);
  return (
    areaEntitled(area, state.enabled, state.featureAvailability) &&
    areaVisibleTo(area, state.capabilities) &&
    areaRelevantToShape(area, state.schedulableWork)
  );
}

/**
 * Every area visible in navigation for the given state — one predicate, so `OrgNav` (grouped)
 * and the phone Menu (the same sidebar) can never diverge on eligibility even though they render
 * differently. `enabled` is legacy module keys, `featureAvailability` is the
 * canonical resolver's available-and-entitled-and-active Feature keys
 * (`availableFeatureKeys(organizationResolvedFeatureStates(...))`), and `capabilities` is the
 * role-relevance layer — all three optional, and passing none shows everything a
 * business has switched on, exactly as before either of the latter two existed.
 */
export function visibleAreas(
  enabled?: ReadonlySet<string>,
  capabilities?: ReadonlySet<Capability>,
  featureAvailability?: ReadonlySet<string>,
  schedulableWork?: boolean,
): Area[] {
  return AREAS.filter(
    (area) =>
      area.sidebar !== false &&
      areaEntitled(area, enabled, featureAvailability) &&
      areaVisibleTo(area, capabilities) &&
      areaRelevantToShape(area, schedulableWork),
  );
}

export function areasIn(
  group: AreaGroup,
  enabled?: ReadonlySet<string>,
  capabilities?: ReadonlySet<Capability>,
  featureAvailability?: ReadonlySet<string>,
  schedulableWork?: boolean,
): Area[] {
  return visibleAreas(enabled, capabilities, featureAvailability, schedulableWork).filter((area) => area.group === group);
}

export function areaHref(organizationId: string, segment: string): string {
  const route = AREAS.find((area) => area.segment === segment)?.route ?? segment;
  return `/organizations/${organizationId}/${route}`;
}

/**
 * "Enter this business" — the one canonical destination, for every caller whose job is switching
 * into an organization rather than linking to a specific area inside one. **The lifecycle state is
 * part of the answer and a required argument, so no caller can forget to ask:** a business still
 * Every organization enters through Home (`AREAS[0]`). Setup state is surfaced contextually on
 * Home rather than changing the organization's canonical destination.
 */
export function organizationHomeHref(organizationId: string, operationalState: OperationalState): string {
  void operationalState;
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
    label: module.configuredAt.label ?? area?.label ?? module.configuredAt.segment,
  };
}

/** Which area a pathname is **in**, for the current navigation entry — a detail route counts, so reading one job still marks Work. */
export function currentSegment(pathname: string): string | null {
  const parts = pathname.split(/[?#]/)[0].split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'organizations') return null;
  const segment = parts[2];
  return AREAS.some((area) => area.segment === segment) ? segment : null;
}

/**
 * An area's name, for the `<h1>` of its root page. One string is still both the navigation entry
 * and the heading — the page reads it from here rather than writing it again, so the two cannot
 * drift. Throws on an unknown segment: a page naming an area that does not exist is a build
 * mistake, not a runtime case to render around.
 */
/** A workspace's name, for the heading of its overview page — the one place an area's page is titled by its Product. */
export function workspaceLabel(key: WorkspaceKey): string {
  const workspace = WORKSPACES.find((candidate) => candidate.key === key);
  if (!workspace) throw new Error(`No workspace has the key "${key}".`);
  return workspace.label;
}

export function areaLabel(segment: string): string {
  const area = AREAS.find((candidate) => candidate.segment === segment);
  if (!area) throw new Error(`No area has the segment "${segment}".`);
  return area.label;
}

/**
 * The static ancestor trail for a page of a workspace, read from the one hierarchy that already
 * owns workspace membership (`Area.workspace`) rather than a page inventing its own. The current
 * organization is never one of these crumbs — the sidebar's own identity row already establishes
 * it, and repeating it in the trail would say the same thing twice (`Platform → Business →
 * Workspace → Page`, with the sidebar carrying the first two).
 *
 * A workspace's own Home names no ancestor and no redundant current-page crumb (`Sales`, not
 * `Sales / Sales` or `Sales / Home`) — its `<h1>` is `workspaceLabel`, read directly. A page of a
 * workspace with several pages still names only the workspace: `Pipeline` reads as
 * `Sales / Pipeline`, not `Sales / Customers / Pipeline` — the workspace is the ancestor, its pages
 * are peers. Every workspace ancestor links to its canonical Home (`WORKSPACES[].home`).
 */
export function workspaceAncestry(organizationId: string, segment: string): { label: string; href?: string }[] {
  const workspace = WORKSPACES.find((candidate) => candidate.home === segment);
  if (workspace) return [];
  const area = AREAS.find((candidate) => candidate.segment === segment);
  if (!area?.workspace) return [];
  const owner = WORKSPACES.find((candidate) => candidate.key === area.workspace)!;
  return [{ label: owner.label, href: areaHref(organizationId, owner.home) }];
}


export type WorkspaceConfigureDoor = {
  /** A `CONFIG_TARGETS` key — the path, entitlement and permission come from there. */
  target: string;
  label: string;
  /** A section of the destination page, e.g. `#getting-paid`. */
  hash?: string;
};

/**
 * What each workspace's Configure control offers, by registered target. One door renders as a
 * link, several as a menu (`ConfigureMenu`); a door the member may not configure, or the business
 * is not entitled to, is omitted. CRM concerns also populate its persistent Configuration sidebar branch.
 * The order is the order of the concerns, most frequently changed first.
 */
export const WORKSPACE_CONFIGURE: Partial<Record<WorkspaceKey, readonly WorkspaceConfigureDoor[]>> = {
  crm: [{ target: 'sales-stages', label: 'Relationship stages' }, { target: 'opportunity-stages', label: 'Opportunity stages' }, { target: 'customer-fields', label: 'Customer fields' }],
  communications: [
    { target: 'call-setup', label: 'Calling & routing' },
    { target: 'communications', label: 'Messaging' },
    { target: 'phone-numbers', label: 'Numbers & assignments' },
    { target: 'email', label: 'Email' },
    { target: 'schedule-configuration', label: 'Business hours' },
    { target: 'call-setup', label: 'Recording & compliance (information)', hash: '#recording' },
  ],
  marketing: [{ target: 'forms', label: 'Forms & acquisition sources' }],
  support: [
    { target: 'support-queues', label: 'Queues' },
    { target: 'support-service-levels', label: 'Service levels' },
  ],
  field: [
    { target: 'work-configuration', label: 'Work types & workflow' },
    { target: 'schedule-configuration', label: 'Scheduling & hours' },
    { target: 'resources', label: 'Resources' },
    { target: 'locations', label: 'Locations' },
  ],
  finance: [
    { target: 'pricing', label: 'Services & pricing' },
    { target: 'pricing', label: 'Payment collection', hash: '#getting-paid' },
  ],
  automations: [
    { target: 'automation-rules', label: 'Rules' },
    { target: 'automation-messages', label: 'Message templates' },
  ],
  ai: [
    { target: 'ai-agents', label: 'Agents' },
    { target: 'ai-deployments', label: 'Channel deployments' },
    { target: 'ai-knowledge', label: 'Knowledge' },
    { target: 'ai-tools', label: 'Tools & permissions' },
  ],
  studio: [
    { target: 'website', label: 'Website' },
    { target: 'forms', label: 'Forms' },
    { target: 'branding', label: 'Branding' },
    { target: 'public-profile', label: 'Public profile' },
    { target: 'domains', label: 'Domains' },
  ],
};

export type ConfigureItem = { key: string; label: string; href: string };

/** The doors a member may be offered from `workspace`'s Configure control, resolved to hrefs. */
export function workspaceConfigureItems(organizationId: string, workspace: WorkspaceKey, gate: ConfigGate): ConfigureItem[] {
  const doors = WORKSPACE_CONFIGURE[workspace] ?? [];
  if (!doors.some(door => { const target = configTarget(door.target); return target.workspace === workspace && target.treatment !== 'operating' && configTargetOffered(target, gate); })) return [];
  return doors.flatMap((door) => {
    const target = configTarget(door.target);
    if (target.treatment === 'operating' || !configTargetOffered(target, gate)) return [];
    return [{ key: `${door.target}${door.hash ?? ''}`, label: door.label, href: `/organizations/${organizationId}/${target.path}${door.hash ?? ''}` }];
  });
}

/** The registered configuration target a corrective link points at, found by its path — so a surface that only holds an href can still ask who may configure it. */
export function configTargetForHref(href: string): ConfigTarget | undefined {
  const path = href.split(/[?#]/)[0].replace(/^\/organizations\/[^/]+\//, '');
  return CONFIG_TARGETS.find((target) => target.path === path);
}

/** Most specific registered workspace configuration resource, including a record beneath it. */
export function workspaceConfigurationTarget(pathname: string): ConfigTarget | undefined {
  const path = pathname.split(/[?#]/)[0].replace(/^\/organizations\/[^/]+\//, '').replace(/\/$/, '');
  return CONFIG_TARGETS.filter(target => target.workspace && !target.treatment && (path === target.path || path.startsWith(`${target.path}/`))).sort((a, b) => b.path.length - a.path.length)[0];
}


/** One root per registered workspace; absent when it has no real configuration concerns. */
export function workspaceConfigurationHref(organizationId: string, workspace: WorkspaceKey): string {
  const owner = WORKSPACES.find(candidate => candidate.key === workspace)!;
  return `/organizations/${organizationId}/${owner.home}/configuration`;
}

export function workspaceConfigurationOwner(pathname: string): WorkspaceKey | undefined {
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, '');
  const organization = path.match(/^\/organizations\/([^/]+)\//)?.[1];
  if (!organization) return undefined;
  const root = WORKSPACES.find(workspace => path === workspaceConfigurationHref(organization, workspace.key) || path.startsWith(`${workspaceConfigurationHref(organization, workspace.key)}/`));
  if (root) return root.key;
  const target = CONFIG_TARGETS.filter(target => target.workspace && !target.treatment && (path === `/organizations/${organization}/${target.path}` || path.startsWith(`/organizations/${organization}/${target.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return target?.workspace;
}
