import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Bot, Headset, Megaphone, Wrench } from 'lucide-react';
import {
  AREAS,
  AREA_GROUPS,
  CONFIG_TARGETS,
  MODULES,
  WORKSPACES,
  areaHref,
  areaLabel,
  areasIn,
  currentSegment,
  moduleConfiguration,
  organizationHomeHref,
  visibleAreas,
  type Module,
} from '@/lib/navigation';
import { SETTINGS_SECTIONS } from '@/features/settings/settings-map';
import { AREA_ICONS, NAV_ICONS } from '@/app/organizations/[organizationId]/org-shell';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The shell's navigation is the only place the platform's own nouns are written down, and
 * this file is what makes that a fact rather than an intention.
 *
 * Unlike every other suite here it touches no database, because there is no policy to prove
 * for most of this file — `lib/navigation.ts` deliberately gates almost nothing on capability,
 * and the reason is written there. `relevantCapabilities` (Slice E) is the narrow exception,
 * and even it changes only what the sidebar renders; a direct navigation is still refused
 * server-side by RLS regardless. What the rest of this file proves is completeness in both
 * directions: a route with no navigation entry is unreachable except by typing its URL, and an
 * entry with no route is a dead link. Both were live risks the moment nine pages stopped
 * linking to each other and started linking to a list.
 */

const ROUTES = fileURLToPath(new URL('../../../app/organizations/[organizationId]', import.meta.url));
const WEB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Direct child route directories that render a page — the areas of one business. */
function routeSegmentsOnDisk(): string[] {
  return readdirSync(ROUTES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // A dynamic segment is a detail route inside an area, not an area: `[customerId]`
    // belongs to Customers. Nothing like that exists at this level today, and the filter is
    // here so that adding one does not read as a missing navigation entry.
    .filter((entry) => !entry.name.startsWith('[') && !entry.name.startsWith('_'))
    // `platform` is a scope, not an area: Platform Administration, available only inside GOLD's own
    // organization. It has its own registry (`lib/platform-navigation.ts`) and its own guard.
    .filter((entry) => entry.name !== 'platform')
    .filter((entry) => existsSync(`${ROUTES}/${entry.name}/page.tsx`))
    .map((entry) => entry.name)
    .sort();
}

describe('the operator shell navigation', () => {
  it('points every entry at a route that exists', () => {
    for (const area of AREAS) {
      expect(
        existsSync(`${ROUTES}/${area.route ?? area.segment}/page.tsx`),
        `navigation names "${area.segment}", which has no page`,
      ).toBe(true);
    }
  });

  it('names every area a business has', () => {
    // The direction that catches the real mistake. Adding a screen and forgetting the
    // navigation used to be invisible, because the index page listed areas by hand and
    // nothing compared the two lists.
    // A page of a larger route (`customers/pipeline`) is found under the directory its route starts with.
    expect([...new Set(AREAS.map((area) => (area.route ?? area.segment).split('/')[0]))].sort()).toEqual(routeSegmentsOnDisk());
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
    for (const area of AREAS.filter((entry) => entry.sidebar !== false)) {
      expect(AREA_ICONS[area.segment], `"${area.segment}" has no rail icon`).toBeDefined();
    }
  });

  it('gives every registered workspace row an icon — a canonical key with no NAV_ICONS entry renders blank in the collapsed rail and the phone Menu', () => {
    // Only a workspace with a real Home draws a row (`projectShell`).
    for (const workspace of WORKSPACES.filter((entry) => entry.home)) {
      expect(NAV_ICONS[`workspace-${workspace.key}`], `"workspace-${workspace.key}" has no nav icon`).toBeDefined();
    }
  });

  it('marks the area a detail route belongs to', () => {
    const [work] = AREAS; // Home, the first area
    expect(currentSegment(areaHref('org-1', work.segment))).toBe(work.segment);
    expect(currentSegment(`/organizations/org-1/${work.segment}/item-9`)).toBe(work.segment);
    expect(currentSegment(`/organizations/org-1/${work.segment}?type=abc`)).toBe(work.segment);
  });

  it('reads an area’s page heading from the same entry as its navigation label', () => {
    const [work] = AREAS; // Home, the first area
    expect(areaLabel(work.segment)).toBe(work.label);
    expect(() => areaLabel('no-such-area')).toThrow();
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
    expect(order[0]).toBe('home');
    expect(order[order.length - 1]).toBe('settings');
  });

  it('makes a page of a workspace a child, never a peer: every page names a real workspace', () => {
    // `Area.workspace` is what stops Work, Schedule, Resources, Locations and Assets being five peers
    // of Customers. A workspace has pages independently of the commercial catalogue.
    for (const area of AREAS.filter((entry) => entry.workspace)) {
      expect(WORKSPACES.some((workspace) => workspace.key === area.workspace), `"${area.segment}" names a workspace that is not one`).toBe(true);
      // Workspace ownership also applies to tools launched from Home without sidebar rows.
      if (area.sidebar !== false) expect(area.group, `"${area.segment}"`).toBe('workspaces');
    }
  });

  it('keeps Opportunity tools under CRM without permanent sidebar children', () => {
    for (const segment of ['opportunities', 'opportunity-pipeline']) {
      expect(AREAS.find((area) => area.segment === segment)).toMatchObject({ workspace: 'crm', sidebar: false });
    }
    expect(areaHref('org', 'opportunity-pipeline')).toBe('/organizations/org/opportunities/pipeline');
  });

  it('registers every workspace and draws a row for only those with a page', () => {
    // The registry is the target taxonomy in the customer's order; visibility is derived from pages,
    // never a flag on the workspace and never an entitlement. Insights is not registered here at
    // all — it is cross-cutting, not a ninth workspace (D66).
    expect(WORKSPACES.map((workspace) => workspace.key)).toEqual([
      'crm', 'communications', 'marketing', 'support', 'field', 'finance', 'automations', 'ai', 'studio',
    ]);
    const withAPage = (key: string) => AREAS.some((area) => area.workspace === key && area.group === 'workspaces' && area.sidebar !== false);
    expect(WORKSPACES.filter((workspace) => withAPage(workspace.key)).map((workspace) => workspace.key)).toEqual([
      'crm', 'communications', 'marketing', 'support', 'field', 'finance', 'automations', 'ai', 'studio',
    ]);
    expect(WORKSPACES.filter((workspace) => !withAPage(workspace.key))).toEqual([]);
  });

  it('assigns canonical workspace icons without changing Work', () => {
    for (const [key, icon] of [['marketing', Megaphone], ['support', Headset], ['ai', Bot], ['field', Wrench]] as const) {
      expect(AREA_ICONS[key]).toBe(icon);
      expect(NAV_ICONS[`workspace-${key}`]).toBe(icon);
    }
  });

  it.each(['ai'])('%s has one guarded starting Home and no invented child destinations', (key) => {
    expect(WORKSPACES.find((workspace) => workspace.key === key)?.home).toBe(key);
    expect(AREAS.filter((area) => area.workspace === key)).toEqual([
      { segment: key, label: areaLabel(key), group: 'workspaces', workspace: key },
    ]);
    const page = readFileSync(`${ROUTES}/${key}/page.tsx`, 'utf8');
    expect(page).toContain('await requireOrganization(organizationId)');
    expect(page).toContain('<AiWorkspace');
    expect(page).toContain('loadAiWorkspace');
    expect(page).not.toMatch(/redirect\(|href=|<Widget|<Card|\.insert\(|\.update\(|\.upsert\(|platform|credentials/i);
    expect(readdirSync(`${ROUTES}/${key}`)).toContain('page.tsx');
  });

  it.each([
    ['support', ['support.read']],
    ['marketing', ['marketing.read', 'marketing.manage']],
  ])('%s retains one flat workspace row with its read authority', (key, capabilities) => {
    expect(AREAS.filter((area) => area.workspace === key)).toEqual([
      { segment: key, label: areaLabel(key as string), group: 'workspaces', workspace: key, relevantCapabilities: capabilities },
    ]);
  });

  it('uses the nine stable canonical workspace identities and default labels', () => {
    const label = (key: string) => WORKSPACES.find((workspace) => workspace.key === key)?.label;
    expect(label('ai')).toBe('AI');
    expect(label('crm')).toBe('CRM');
    expect(label('communications')).toBe('Communications');
    expect(label('marketing')).toBe('Marketing');
    expect(label('support')).toBe('Support');
    expect(label('automations')).toBe('Automations');
    expect(label('field')).toBe('Work');
    for (const workspace of WORKSPACES) {
      expect(workspace.key).not.toBe('agents');
      expect(workspace.key).not.toBe('workspace');
      expect(workspace.key).not.toBe('insights');
      expect(workspace.key).not.toBe('sales');
      expect(workspace.key).not.toBe('service');
      expect(workspace.key).not.toBe('comms');
      expect(workspace.label).not.toMatch(/^Gild /);
      expect(workspace.label).not.toMatch(/agents|workspace/i);
    }
  });

  it('gives every workspace an owner-side map: pages and configuration name the workspace that owns them', () => {
    const owner = (segment: string) => AREAS.find((area) => area.segment === segment)?.workspace;
    expect(['sales', 'customers', 'pipeline'].map(owner)).toEqual(['crm', 'crm', 'crm']);
    expect(['comms', 'calls', 'comms-inbox', 'comms-numbers'].map(owner)).toEqual(['communications', 'communications', 'communications', 'communications']);
    expect(['automations', 'automation-rules'].map(owner)).toEqual(['automations', 'automations']);
    expect(owner('pricing')).toBe('finance');
    // Insights is cross-cutting, not a workspace (D66) — it belongs to no one workspace either.
    expect(owner('insights')).toBeUndefined();
    expect(['work', 'schedule', 'resources', 'locations', 'assets'].map(owner)).toEqual(Array(5).fill('field'));
    // Home is the cross-workspace cockpit and the cross-cutting configuration areas are nobody's.
    for (const shared of ['home', 'fields', 'roles', 'setup', 'integrations', 'settings']) {
      expect(owner(shared), `${shared} belongs to no one workspace`).toBeUndefined();
    }
    const configOwner = (key: string) => CONFIG_TARGETS.find((target) => target.key === key)?.workspace;
    expect(configOwner('branding')).toBe('studio');
    expect(configOwner('pricing')).toBe('finance');
    expect(configOwner('communications')).toBe('communications');
    expect(configOwner('team')).toBeUndefined();
    // Website earned its own operating page (D68): it is an `Area`, not a `ConfigTarget`, and the
    // Settings map names nothing by this key any more.
    expect(configOwner('website')).toBe('studio');
    expect(AREAS.find((area) => area.segment === 'studio-website')?.workspace).toBe('studio');
  });

  it('gives Work a Home, Work items, Schedule, Resources, Locations and Equipment & Assets as its pages', () => {
    expect(AREAS.filter((area) => area.workspace === 'field').map((area) => area.segment)).toEqual([
      'field', 'work', 'schedule', 'resources', 'locations', 'assets',
    ]);
    expect(existsSync(`${ROUTES}/field/page.tsx`)).toBe(true);
    // Customer-facing navigation no longer says Operations.
    expect(AREAS.some((area) => area.label === 'Operations')).toBe(false);
    expect(WORKSPACES.find((workspace) => workspace.key === 'field')?.label).toBe('Work');
    // Home is the workspace's own row, not a redundant 'Overview' child.
    expect(AREAS.find((area) => area.segment === 'field')?.label).not.toBe('Overview');
    // The existing routes stay canonical: no address moved to say which workspace a page belongs to.
    for (const segment of ['work', 'schedule', 'resources', 'locations', 'assets']) {
      expect(existsSync(`${ROUTES}/${segment}/page.tsx`)).toBe(true);
    }
  });

  it('leads with the area an operator opens the application for', () => {
    // Not alphabetisation and not an accident: Home comes first for every renderer, and this is the
    // area that answers "what do I do next".
    expect(AREAS[0].segment).toBe('home');
  });

  it('splits every area into exactly one group', () => {
    // A fact about `AREAS` itself — every area belongs to exactly one group whether or not it
    // currently renders in the sidebar — so this reads the array directly rather than through
    // `areasIn`, which also applies Slice 3's `sidebar` filter.
    const total = AREA_GROUPS.reduce(
      (sum, group) => sum + AREAS.filter((area) => area.group === group.key).length,
      0,
    );
    expect(total).toBe(AREAS.length);
  });
  it('keeps Platform Administration out of a business’s navigation, on every rendering', () => {
    const shell = readFileSync(`${ROUTES}/org-shell.tsx`, 'utf8');
    expect(shell).not.toMatch(/PLATFORM_NAV|PlatformPhoneNavMenu|GoldPlatformNav|inPlatformContext/);
    expect(shell).not.toMatch(/platformStaff|isGoldInternal/);
  });

  it('draws no permanent row for the Agent — Ask is a rail on every workspace, not an area', () => {
    expect(AREAS.some((area) => area.segment === 'ask')).toBe(false);
    expect(AREA_ICONS.ask).toBeUndefined();
    expect(existsSync(`${ROUTES}/ask`)).toBe(false);
    // A bookmark still lands somewhere true; the assistant module and capability are untouched.
    const config = readFileSync(`${WEB_ROOT}/next.config.ts`, 'utf8');
    expect(config).toContain('/organizations/:organizationId/ask');
    expect(MODULES.some((sold) => sold.key === 'assistant')).toBe(true);
  });

  it('keeps only places somebody works in the sidebar, and configuration behind canonical owners', () => {
    const inSidebar = AREAS.filter((area) => area.sidebar !== false).map((area) => area.segment);
    expect(inSidebar).toEqual([
      'home',
      'library',
      'calendar',
      'sales', 'customers', 'pipeline',
      'comms', 'calls', 'comms-inbox',
      'marketing', 'support', 'ai',
      'finance', 'finance-quotes', 'finance-invoices', 'finance-payments',
      'automations', 'automation-rules', 'automation-messages', 'automation-activity',
      'field', 'work', 'schedule', 'resources', 'locations', 'assets',
      'studio', 'studio-website', 'studio-portal', 'studio-forms', 'studio-templates',
      'settings',
    ]);
    for (const segment of ['pricing', 'fields', 'roles', 'integrations', 'setup']) {
      const area = AREAS.find((entry) => entry.segment === segment)!;
      expect(area.sidebar, `${segment} is configuration and belongs outside operating navigation`).toBe(false);
      expect(area.group).toBe('settings');
    }
  });
});

/**
 * "Enter this business" — one canonical destination, not `AREAS[0].segment` re-derived at every
 * call site that means "switch into this organization" (`ContextSwitcher`, `/organizations`,
 * post-auth landing, the doorway at `/organizations/[organizationId]`).
 */
describe('organizationHomeHref', () => {
  it('resolves to the first area, through areaHref', () => {
    expect(organizationHomeHref('org-1', 'live')).toBe(areaHref('org-1', AREAS[0].segment));
    expect(organizationHomeHref('org-1', 'live')).toBe('/organizations/org-1/home');
    expect(organizationHomeHref('org-1', 'setup')).toBe('/organizations/org-1/home');
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
    for (const segment of ['home', 'work', 'schedule', 'customers', 'settings']) {
      expect(shown.map((area) => area.segment)).toContain(segment);
    }
    // And the two that are modules are gone. This is a module gate, not the capability-relevance
    // layer Slice E added: a role that cannot manage locations still sees Locations and is told
    // why (I12, evolved — most areas stay ungated on capability), whereas a module the business
    // never bought is not part of that business at all. `assets` is absent here
    // purely because its module is off, independent of any capability.
    expect(shown.map((area) => area.segment)).not.toContain('assets');
  });

  it('shows an area once its module is on', () => {
    const shown = areasIn('workspaces', new Set(['assets']));
    expect(shown.map((area) => area.segment)).toContain('assets');

    const withAutomations = areasIn('workspaces', new Set(['automations']));
    expect(withAutomations.map((area) => area.segment)).toContain('automations');

    // And with nothing passed, every area still in the sidebar: a caller with no business in
    // hand means all of it, on the module axis. `sidebar: false` areas (only Guided setup today)
    // stay absent regardless — that filter is orthogonal to which modules are enabled, not a
    // relaxation of it.
    const sidebarAreas = AREAS.filter((area) => area.sidebar !== false).length;
    expect(AREA_GROUPS.reduce((sum, group) => sum + areasIn(group.key).length, 0)).toBe(
      sidebarAreas,
    );
  });
});

/**
 * Canonical Feature-level gating (M17 closure slice). `Area.featureKeys` and
 * `availableFeatureKeys(organizationResolvedFeatureStates(...))` are what let one area resolve
 * against the *specific* canonical Feature(s) it is the surface for, rather than the coarser
 * legacy `ModuleKey` several Features can share. No database here — these are properties of the
 * pure predicate (`areaEntitled`/`visibleAreas`/`areasIn`), proven with hand-built resolved
 * states rather than a live resolver; `feature-activation.test.ts` covers the resolver itself
 * against real Postgres.
 */
describe('canonical Feature-level navigation gating', () => {
  const calls = AREAS.find((area) => area.segment === 'calls')!;

  it('is defined for the areas the audit named, using real catalogue feature keys', () => {
    expect(AREAS.find((a) => a.segment === 'insights')?.featureKeys).toEqual([
      'saved_dashboards',
      'saved_reports',
      'utilization',
    ]);
    expect(calls.featureKeys).toEqual(['inbound_calling', 'outbound_calling', 'recording', 'call_dispositions']);
    expect(AREAS.find((a) => a.segment === 'pricing')?.featureKeys).toEqual([
      'price_book',
      'quote_creation',
      'invoices',
    ]);
    expect(AREAS.find((a) => a.segment === 'automations')?.featureKeys).toEqual([
      'rule_authoring',
      'domain_event_trigger',
      'email_action',
      'run_history',
    ]);
    expect(AREAS.find((a) => a.segment === 'integrations')?.featureKeys).toEqual([
      'app_connections',
      'file_imports',
      'data_mapping',
      'scheduled_sync',
      'triggers_actions',
      'agent_tools',
    ]);
    expect(AREAS.find((a) => a.segment === 'assets')?.featureKeys).toEqual(['assets']);
  });

  it('hides a feature-specific area once every one of its backing Features is unavailable (disabled)', () => {
    const enabled = new Set(['reception']);
    const withAllActive = new Set(calls.featureKeys);
    expect(areasIn('workspaces', enabled, undefined, withAllActive).map((a) => a.segment)).toContain('calls');

    // Every Calls-backing Feature disabled (the activation override cleared them from
    // `availableFeatureKeys`) — the area disappears even though the legacy module is still on.
    const noneActive = new Set<string>();
    expect(areasIn('workspaces', enabled, undefined, noneActive).map((a) => a.segment)).not.toContain('calls');
  });

  it('restores the area once a backing Feature is available again (override removed)', () => {
    const enabled = new Set(['reception']);
    const oneRestored = new Set(['outbound_calling']);
    expect(areasIn('workspaces', enabled, undefined, oneRestored).map((a) => a.segment)).toContain('calls');
  });

  it('hides a feature-specific area the organization is simply not entitled to', () => {
    // No Calls-backing key present at all — never entitled, not merely disabled — same absence.
    const enabled = new Set(['reception']);
    const unentitled = new Set(['pipeline']); // a sibling Feature under the same legacy module key
    expect(areasIn('workspaces', enabled, undefined, unentitled).map((a) => a.segment)).not.toContain('calls');
  });

  it('keeps a feature-specific area visible when it is merely setup_required rather than off', () => {
    // Readiness ('ready' vs 'setup_required') plays no part in `availableFeatureKeys` — a Feature
    // that is implemented, entitled and active still counts even with nothing configured yet.
    // Only 'unavailable' (not implemented, not entitled, or disabled) is ever absent from the set.
    const available = new Set(['outbound_calling']);
    expect(areasIn('workspaces', new Set(['reception']), undefined, available).map((a) => a.segment)).toContain(
      'calls',
    );
  });

  it('still requires a relevant capability on top of Feature availability', () => {
    const enabled = new Set(['reception']);
    const available = new Set(calls.featureKeys);

    const noCapability = areasIn('workspaces', enabled, new Set<Capability>(), available);
    expect(noCapability.map((a) => a.segment)).not.toContain('calls');

    const withCapability = areasIn('workspaces', enabled, new Set<Capability>(['call.place']), available);
    expect(withCapability.map((a) => a.segment)).toContain('calls');
  });

  it('leaves kernel areas untouched by feature availability, empty or not', () => {
    const shown = AREA_GROUPS.flatMap((group) => areasIn(group.key, new Set(), undefined, new Set()));
    for (const segment of ['home', 'work', 'schedule']) {
      expect(shown.map((a) => a.segment)).toContain(segment);
    }
  });

  it('proves the shared-module granularity fix: a sibling Feature staying active must not keep a different area visible', () => {
    // The real production seam (D46): `pipeline`, `configurable_stages` and `qualification_state`
    // (the CRM pipeline, which Customers reads) share the legacy `reception` module key with
    // `inbound_calling`/`outbound_calling`/`recording`/`call_dispositions` (Calls). A raw
        // module-key gate (`activeModuleKeys`) reports `reception` as "active" as long as any one of
    // those seven Features is active — which is exactly the bug: Calls must not ride along on a
    // sibling Feature it does not actually surface.
    const enabledAtModuleLevel = new Set(['reception']); // module reads "active" via the legacy gate
    const onlyPipelineActive = new Set(['pipeline']); // none of Calls' own featureKeys

    // The legacy module-only call (no featureAvailability) would show it — the very gap this
    // slice closes for callers that do supply the canonical resolution.
    expect(areasIn('workspaces', enabledAtModuleLevel).map((a) => a.segment)).toContain('calls');

    // With featureAvailability supplied, Calls is correctly absent despite the module key
    // reading "active", because none of its own backing Features are in the available set.
    expect(areasIn('workspaces', enabledAtModuleLevel, undefined, onlyPipelineActive).map((a) => a.segment)).not.toContain(
      'calls',
    );
  });

  it('computes identical eligibility for desktop (grouped areasIn) and mobile (flat visibleAreas) from the same input', () => {
    const enabled = new Set(['reception', 'billing', 'assets']);
    const capabilities = new Set<Capability>(['call.place', 'price.manage']);
    const available = new Set(['outbound_calling', 'inbound_calling', 'price_book', 'assets']);

    const desktop = AREA_GROUPS.flatMap((group) => areasIn(group.key, enabled, capabilities, available)).map(
      (a) => a.segment,
    );
    const mobile = visibleAreas(enabled, capabilities, available).map((a) => a.segment);

    // Presentation differs (grouped vs. flat); the set of eligible segments must not.
    expect(new Set(desktop)).toEqual(new Set(mobile));
    expect(desktop.length).toBe(mobile.length);
  });
});

describe('capability-relevance filtering (Slice E)', () => {
  it('leaves every kernel and general operational area visible to any role', () => {
    // Today, Work, Schedule, Customers and the rest of the areas nobody assigned no
    // `relevantCapabilities` — a role with zero capabilities still sees them, exactly as before
    // this field existed (I12).
    const noCapabilities = new Set<Capability>();
    const shown = AREA_GROUPS.flatMap((group) => areasIn(group.key, undefined, noCapabilities));
    for (const segment of ['home', 'work', 'schedule', 'customers', 'locations', 'settings']) {
      expect(shown.map((area) => area.segment)).toContain(segment);
    }
  });

  it('hides a feature-specific area from a role with none of its relevant capabilities', () => {
    const rules = AREAS.find((area) => area.segment === 'automation-rules')!;
    expect(rules.relevantCapabilities).toBeDefined();

    const shown = areasIn('workspaces', new Set(['automations']), new Set());
    expect(shown.map((area) => area.segment)).not.toContain('automation-rules');
  });

  it('shows a feature-specific area to a role holding at least one of its relevant capabilities', () => {
    const shown = areasIn('workspaces', new Set(['automations']), new Set(['automation.manage']));
    expect(shown.map((area) => area.segment)).toContain('automation-rules');
  });

  it('layers on top of the module gate rather than replacing it', () => {
    // Entitled to automations (module on) but the role itself lacks the capability: still hidden.
    // Neither gate alone decides this — both must pass.
    const moduleOnCapabilityOff = areasIn('workspaces', new Set(['automations']), new Set());
    expect(moduleOnCapabilityOff.map((area) => area.segment)).not.toContain('automation-rules');

    // The reverse: the role could manage automations, but the business never bought the module.
    const moduleOffCapabilityOn = areasIn('workspaces', new Set(), new Set(['automation.manage']));
    expect(moduleOffCapabilityOn.map((area) => area.segment)).not.toContain('automation-rules');
  });

  it('passing no capabilities at all shows every area the module gate allows, same as before Slice E', () => {
    const withModuleOnly = areasIn('workspaces', new Set(['automations']));
    expect(withModuleOnly.map((area) => area.segment)).toContain('automation-rules');
  });

  it('Insights is never in the sidebar, whatever the module or capability — it is reached contextually, not as a row (D66)', () => {
    expect(AREAS.find((area) => area.segment === 'insights')?.sidebar).toBe(false);
    const everything = areasIn('workspaces', new Set(['reporting']), new Set(['report.read', 'report.manage']));
    expect(everything.map((area) => area.segment)).not.toContain('insights');
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
      const { segment, path, section } = sold.configuredAt;
      if (!section) continue;

      const source = readFileSync(`${ROUTES}/${segment}${path ? `/${path}` : ''}/page.tsx`, 'utf8');
      expect(source, `"${segment}${path ? `/${path}` : ''}" has no section id="${section}" for module "${sold.key}"`).toContain(
        `id="${section}"`,
      );
    }
  });

  it('gates the booking module’s per-type surface on the booking module', () => {
    // **A module hides what it owns everywhere, not only its own area** — the rule switching
    // `billing` off follows when it takes the quote and the invoice off every job screen.
    // Publishing a kind of work is the second half of public booking: the address is configured
    // in Settings, where `configuredAt` points, and *which types are on the page* is configured
    // per type on Settings → Work (Slice 3 moved this off the operational board, and the rule
    // travelled with it). Leaving that visible with the module off would be half a switch, and
    // it is the kind of thing a refactor removes without noticing, because the control still
    // works.
    //
    // Read from source for the reason the section check above is: the alternative is trusting
    // that whoever moves this section remembers what it was conditional on.
    //
    // `WorkConfiguration` (`features/work/configuration/`) is the shared component behind both
    // Settings → Work and the Work workspace's own Configure rail (contract: one configuration
    // surface, two hosts) — the gate itself lives there now, not in either page.
    const workConfig = readFileSync(
      fileURLToPath(new URL('../../../features/work/configuration/work-configuration.tsx', import.meta.url)),
      'utf8',
    );
    const workConfigurationPage = readFileSync(`${ROUTES}/work/configuration/page.tsx`, 'utf8');

    expect(workConfig).toContain('PublishTypeForm');
    expect(workConfig, 'the publish section is not gated on the booking module').toMatch(
      /bookingEnabled\s*\?[\s\S]{0,400}PublishTypeForm/,
    );
    expect(workConfigurationPage).toContain("enabledModules.has('booking')");
  });

  it('gates the asset reference on a job on the assets module, on both the board and the job page', () => {
    // The same rule as above, one module over: an asset is what the Assets module owns on a
    // job screen, and D25 says a module hides what it owns everywhere. This one was found by
    // the product reality audit rather than caught at the time — the asset picker and badge
    // rendered regardless of whether a business had switched Assets off at all.
    const work = `${readFileSync(`${ROUTES}/work/page.tsx`, 'utf8')}\n${readFileSync(`${WEB_ROOT}/features/work/work-list.tsx`, 'utf8')}`;
    // Phase C (Slice 9) split the work item route into a loader (where `enabledModules` is read)
    // and a Screen/sections/edit-sheet (where `assetsEnabled` is consumed) the thin page
    // delegates to.
    const workItem = `${readFileSync(`${WEB_ROOT}/lib/application/work/work-item-detail.ts`, 'utf8')}\n${readFileSync(`${WEB_ROOT}/features/work/work-item-sections.tsx`, 'utf8')}\n${readFileSync(`${WEB_ROOT}/features/work/edit-work-item-sheet.tsx`, 'utf8')}`;

    expect(work).toContain("enabledModules.has('assets')");
    expect(work, 'the create-work-item form is not told whether assets are enabled').toContain(
      'assetsEnabled={assetsEnabled}',
    );
    expect(workItem).toContain("enabledModules.has('assets')");
    expect(workItem, 'the "Asset" detail is not gated on the assets module').toMatch(
      /assetsEnabled\s*\?[\s\S]{0,200}Detail label="Asset"/,
    );
    expect(workItem, 'the edit-work-item form is not told whether assets are enabled').toContain(
      'assetsEnabled={assetsEnabled}',
    );
  });

  it('gates the shell’s Setup treatment on operational_state, not on a module', () => {
    // Setup is a lifecycle state, so its shell treatment must disappear once a business is Live,
    // on its own, with nothing left to remember to turn off. Source scan for the same reason
    // `layout.test.ts` gives: nothing here renders in a harness this repository runs.
    const layout = readFileSync(fileURLToPath(new URL('../../../features/shell/organization-shell.tsx', import.meta.url)), 'utf8');
    const shell = readFileSync(`${ROUTES}/org-shell.tsx`, 'utf8');

    expect(layout).not.toContain("operationalState === 'setup'");
    expect(layout).not.toContain('setup={setup}');
    expect(shell).not.toContain('export function SetupEntry');
    expect(shell).not.toContain('export function SetupNavLink');
    // One treatment, not several: the header badge this replaced must not come back.
    expect(shell).not.toContain('SetupBadge');
    expect(layout).not.toContain('SetupBadge');
  });

  it('builds a link that says where it goes', () => {
    const payments = MODULES.find((sold) => sold.key === 'card_payments')!;
    const where = moduleConfiguration('org-1', payments);

    // Getting paid lives on Pricing, the same workspace as the price book it charges through.
    expect(where.href).toBe('/organizations/org-1/finance/configuration/pricing#getting-paid');
    // The area's own word, which is the platform noun this file owns. A link labelled
    // "configure" would be the one place in the shell where a screen invents a name.
    expect(where.label).toBe('Pricing');

    const booking = MODULES.find((sold) => sold.key === 'booking')!;
    expect(moduleConfiguration('org-1', booking).href).toBe(
      '/organizations/org-1/settings/domains#booking-address',
    );

    const billing = MODULES.find((sold) => sold.key === 'billing')!;
    expect(moduleConfiguration('org-1', billing).href).toBe('/organizations/org-1/finance/configuration/pricing');
    expect(moduleConfiguration('org-1', billing).label).toBe('Pricing');
  });

  it('keeps every module’s configuration link valid', () => {
    // Billing and Automations both configure at their own canonical workspace's segment.
    const billing = MODULES.find((sold) => sold.key === 'billing')!;
    expect(moduleConfiguration('org-1', billing)).toEqual({
      href: '/organizations/org-1/finance/configuration/pricing',
      label: 'Pricing',
    });

    const automations = MODULES.find((sold) => sold.key === 'automations')!;
    expect(moduleConfiguration('org-1', automations)).toEqual({
      href: '/organizations/org-1/automations',
      label: 'Automations',
    });
  });
});

/**
 * Automations is a workspace; Pricing, Custom fields, Team and Integrations are configuration.
 * Ongoing work earns a permanent row, configuring how another workspace behaves is reached from
 * the Settings map — but every one of them stays a real, directly addressable route with its
 * module and capability gating unchanged, so nothing about who may do what moved.
 */
describe('Automations is a workspace; the configuration-only areas sit behind Settings', () => {
  it('keeps Automations in the sidebar, gated by its module and capability', () => {
    expect(areasIn('workspaces', new Set(['automations']), new Set(['automation.manage']))
      .map((area) => area.segment)).toContain('automations');
    expect(areasIn('workspaces', new Set(), new Set(['automation.manage']))
      .map((area) => area.segment)).not.toContain('automations');
  });

  it('keeps each configuration-only area addressable through the one href function, and out of the sidebar', () => {
    for (const segment of ['pricing', 'fields', 'roles', 'integrations'] as const) {
      const area = AREAS.find((entry) => entry.segment === segment);
      expect(area, `${segment} was removed from AREAS entirely`).toBeDefined();
      expect(areaHref('org-1', segment)).toBe(`/organizations/org-1/${segment}`);
      expect(
        AREA_GROUPS.flatMap((group) => areasIn(group.key)).map((entry) => entry.segment),
      ).not.toContain(segment);
    }
  });

  it('keeps the capability that makes each one relevant, for the Settings map to read', () => {
    expect(AREAS.find((a) => a.segment === 'pricing')?.relevantCapabilities).toEqual(['price.manage']);
    expect(AREAS.find((a) => a.segment === 'fields')?.relevantCapabilities).toEqual(['field.manage']);
    expect(AREAS.find((a) => a.segment === 'roles')?.relevantCapabilities).toEqual(['role.manage']);
  });
});

/**
 * The Team workspace recomposition renamed only the user-facing noun — "People and roles" reads
 * as three separate nouns for one workspace; `roles` was already this Area's canonical route and
 * stays it (`CLAUDE.md`: the route is not renamed in this slice). Everything else about the Area
 * — segment, group, capability gating — is untouched.
 */
describe('the roles Area reads as Team', () => {
  it('keeps its segment, route and capability gating, and only the label changes', () => {
    const area = AREAS.find((entry) => entry.segment === 'roles');
    expect(area?.label).toBe('Team');
    expect(area?.segment).toBe('roles');
    expect(area?.group).toBe('settings');
    expect(area?.relevantCapabilities).toEqual(['role.manage']);
    expect(areaHref('org-1', 'roles')).toBe('/organizations/org-1/roles');
  });
});

/**
 * Route metadata versus sidebar visibility — the two must stay separable without a second
 * registry of labels or hrefs anywhere else in the codebase. Only Guided setup uses
 * `sidebar: false` now.
 */
describe('an area hidden from the sidebar', () => {
  it('is absent from the sidebar, the tablet rail and the phone Menu alike — one shared predicate, not two', () => {
    // `projectShell` is the one eligibility rule; `OrgNav` draws its result for desktop, tablet and the
    // phone Menu (the sidebar's own Sheet), so a change to
    // the module gate, the Feature gate or the capability layer cannot reach one renderer and miss another.
    const shell = readFileSync(`${ROUTES}/org-shell.tsx`, 'utf8');
    const projection = readFileSync(fileURLToPath(new URL('../../../lib/shell.ts', import.meta.url)), 'utf8');

    // Every renderer draws the one projection; eligibility (the sidebar flag, entitlement, the
    // capability layer, the configuration targets, platform authority) is decided in `projectShell`.
    expect(projection, 'projectShell should filter on the sidebar flag').toContain('area.sidebar !== false');
    expect(shell, 'the desktop rendering should take the projection, not filter AREAS itself').toContain('sections: ShellSection[]');
    expect(shell, 'the phone menu takes the same sidebar projection').toContain('<OrgNav sections={sections} />');
    expect(shell, 'no renderer keeps its own eligibility filter').not.toMatch(/AREAS[.]filter|visibleAreas[(]|areasIn[(]/);
    expect(shell).toContain("from '@/lib/shell'");
  });
});

/**
 * Guided Setup, off the permanent sidebar — the last piece of the Product Contract's own
 * inconsistency: Business Setup is implementation infrastructure, not a tenant area, and a
 * second equal-weight Configuration row duplicated the elevated SETUP-only treatment Slice 1
 * already built for exactly this purpose.
 */
describe('Guided Setup is no longer a permanent sidebar destination', () => {
  it('is hidden from areasIn regardless of whether drafting is enabled', () => {
    // Sidebar visibility and module gating are orthogonal (Slice 3's own point) — proven here
    // by enabling the module and still finding no sidebar entry.
    const withDrafting = areasIn('settings', new Set(['drafting']));
    expect(withDrafting.map((area) => area.segment)).not.toContain('setup');

    const area = AREAS.find((entry) => entry.segment === 'setup');
    expect(area?.sidebar).toBe(false);
  });

  it('remains a real, directly addressable route', () => {
    const area = AREAS.find((entry) => entry.segment === 'setup');
    expect(area, 'setup was removed from AREAS entirely').toBeDefined();
    expect(areaHref('org-1', 'setup')).toBe('/organizations/org-1/setup');

    // D31's own link for the drafting module still resolves — nothing about `MODULES` or
    // `configuredAt` changed, only where a person finds the sidebar row that used to point here.
    const drafting = MODULES.find((sold) => sold.key === 'drafting')!;
    expect(moduleConfiguration('org-1', drafting)).toEqual({
      href: '/organizations/org-1/setup',
      label: 'Setup',
    });
  });

  it('still gets its SETUP-only shell treatment, and no second row in Configuration', () => {
    const layout = readFileSync(fileURLToPath(new URL('../../../features/shell/organization-shell.tsx', import.meta.url)), 'utf8');
    expect(layout).not.toContain('setup={setup}');

    // `OrgNav` — the ordinary Configuration-group renderer — is generic over `AREAS`/`areasIn`
    // and must not special-case 'setup' itself; if it did, that would be the second,
    // equal-weight row this patch exists to remove. Extracted by name rather than grepping the
    // whole file, since `SetupEntry`/`SetupNavLink` legitimately mention 'setup' right beside it.
    const shell = readFileSync(`${ROUTES}/org-shell.tsx`, 'utf8');
    const orgNavBody = shell.slice(shell.indexOf('export function OrgNav('), shell.indexOf('function MobileAgentEntry('));
    expect(orgNavBody, 'OrgNav should not hardcode a setup-specific row').not.toContain("'setup'");
  });

  it('gives Settings a path back to it, worded so Launch never sounds available again', () => {
    const settings = readFileSync(`${ROUTES}/settings/page.tsx`, 'utf8');
    expect(SETTINGS_SECTIONS.find((section) => section.key === 'setup')).toBeUndefined();
    expect(settings).not.toContain('setupSentence');
  });

  it('never renders Launch again on /setup once the business is LIVE', () => {
    // `LaunchReview` — and so `LaunchForm` — is gated on `inSetup`, so a LIVE business visiting
    // `/setup` directly sees no Launch control to press, on top of the database's own refusal if
    // one were pressed anyway (`lifecycle.test.ts`: a second attempt is `organizations.already_live`).
    const setup = readFileSync(`${ROUTES}/setup/page.tsx`, 'utf8');
    expect(setup).toContain('live={!inSetup}');
    const guided = readFileSync(`${ROUTES}/../../../features/setup/guided-setup.tsx`, 'utf8');
    expect(guided).toMatch(/live \? <Card[\s\S]*?: <LaunchReview/);
  });
});

/**
 * The operating shell's taxonomy: Home, workspaces, and Settings. Operator workspaces are places
 * somebody works — not the commercial catalogue, and not one row per SKU.
 */
describe('the organization shell taxonomy', () => {
  const inSidebar = AREAS.filter((area) => area.sidebar !== false);

  it('has exactly one Home, first, and it is the only canonical landing', () => {
    expect(AREAS.filter((area) => area.label === 'Home').map((area) => area.segment)).toEqual(['home']);
    expect(inSidebar[0].segment).toBe('home');
    expect(organizationHomeHref('org-1', 'live')).toBe('/organizations/org-1/home');
  });

  it('keeps Today and Reports off disk and out of the registry: they are redirects, not destinations', () => {
    for (const old of ['today', 'reports']) {
      expect(AREAS.some((area) => area.segment === old)).toBe(false);
      expect(existsSync(`${ROUTES}/${old}`), `${old} must not be a route beside its replacement`).toBe(false);
    }
    const config = readFileSync(`${WEB_ROOT}/next.config.ts`, 'utf8');
    expect(config).toContain('source: "/organizations/:organizationId/today", destination: "/organizations/:organizationId/home"');
    expect(config).toContain('source: "/organizations/:organizationId/reports", destination: "/organizations/:organizationId/insights/reports"');
  });

  it('names the workspaces in the operator’s words', () => {
    const labels = new Map(AREAS.map((area) => [area.segment, area.label]));
    expect(labels.get('calls')).toBe('Calls');
    expect(labels.get('comms-inbox')).toBe('Inbox');
    expect(labels.get('comms-numbers')).toBe('Numbers');
    expect(labels.get('automations')).toBe('Automations');
    expect(labels.get('automation-rules')).toBe('Rules');
    expect(labels.get('insights')).toBe('Insights');
    // Registered workspaces, in the order a customer meets them, with no Gild prefix and no ninth
    // Insights row. Which of them draw a row is a fact about pages.
    expect(WORKSPACES.map((workspace) => workspace.label)).toEqual([
      'CRM', 'Communications', 'Marketing', 'Support', 'Work', 'Finance', 'Automations', 'AI', 'Studio',
    ]);
  });

  it('adds no workspace whose surface does not exist yet', () => {
    // Financials, Website & Portal are target vocabulary, not rows: nothing operates them as a
    // workspace today (see docs/ui-spec.md). Library is shared infrastructure rather than a
    // workspace, and has its own shell — see 'the Library area' below. A row appears with its
    // real route.
    for (const absent of ['financials', 'website', 'documents']) {
      expect(AREAS.some((area) => area.segment === absent), `${absent} has no operating surface yet`).toBe(false);
    }
    // And every workspace row has a page behind it — no placeholder route to satisfy a list.
    for (const area of inSidebar) {
      expect(existsSync(`${ROUTES}/${area.route ?? area.segment}/page.tsx`)).toBe(true);
    }
    // Retired workspace identities must not return as sidebar destinations.
    for (const absent of ['service']) {
      expect(inSidebar.some((area) => area.workspace === absent), `${absent} has no operating surface yet`).toBe(false);
    }
  });

  it('keeps Settings a single, ungrouped row set apart from the workspaces', () => {
    const settings = AREAS.filter((area) => area.group === 'settings' && area.sidebar !== false);
    expect(settings.map((area) => area.segment)).toEqual(['settings']);
    expect(AREA_GROUPS.find((group) => group.key === 'settings')?.label).toBeNull();
  });

  it('draws one section heading: where a workspace is worked in', () => {
    expect(AREA_GROUPS.filter((group) => group.label !== null).map((group) => group.key)).toEqual(['workspaces']);
  });

  it('keeps legacy Insights routes as compatibility redirects without global reporting UI', () => {
    for (const route of ['insights', 'insights/reports']) {
      const source = readFileSync(`${ROUTES}/${route}/page.tsx`, 'utf8');
      expect(source).toContain('redirect(');
      expect(source).toContain("redirect(areaHref(organizationId, 'home'))");
      for (const retired of ['DashboardManagement', 'ReportManagement', 'InsightsViewNav']) {
        expect(source).not.toContain(retired);
      }
    }
    expect(readFileSync(`${ROUTES}/finance/page.tsx`, 'utf8')).not.toContain('Financial insights');
  });
});

/**
 * Library: shared organization infrastructure, never a workspace (docs/domain-model.md,
 * constraints.md D60/D68, docs/ui-spec.md). Ruled apart from Home and from Workspaces, one row
 * today — its internal destinations (Files, Media, Templates, Knowledge, Collections, Sources,
 * Trash) are reached from Library's own page, not a second permanent sidebar.
 */
describe('the Library area', () => {
  const library = AREAS.find((area) => area.segment === 'library')!;

  it('is a real, sidebar-visible area owned by no workspace and no module', () => {
    expect(library).toBeDefined();
    expect(library.group).toBe('library');
    expect(library.sidebar).not.toBe(false);
    expect(library.workspace).toBeUndefined();
    expect(library.module).toBeUndefined();
    expect(WORKSPACES.some((workspace) => (workspace as { key: string }).key === 'library')).toBe(false);
  });

  it('sits directly after Home and outside Workspaces, per AREA_GROUPS order', () => {
    expect(AREA_GROUPS.map((group) => group.key)).toEqual(['home', 'library', 'workspaces', 'settings']);
    expect(AREAS[0].segment).toBe('home');
    expect(AREAS[1].segment).toBe('library');
  });

  it('resolves through the one href function', () => {
    expect(areaHref('org-1', 'library')).toBe('/organizations/org-1/library');
  });

  it('has a page behind every one of its internal destinations', () => {
    for (const segment of ['files', 'media', 'templates', 'knowledge', 'collections', 'sources', 'trash']) {
      expect(existsSync(`${ROUTES}/library/${segment}/page.tsx`), `library/${segment} has no page`).toBe(true);
    }
  });
});

/**
 * URL-addressable sibling views are navigation, never actions (`docs/ui-spec.md` §5b) — a
 * product contract, not a placement rule. `ViewNav`'s own visual position inside a page is a
 * pattern/default and is not pinned here.
 */
describe('sibling views are navigation, not page actions', () => {
  const read = (path: string) => readFileSync(path, 'utf8');
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const UI = fileURLToPath(new URL('../../../../../packages/ui/src/components', import.meta.url));
  const viewNav = read(`${WEB_ROOT}/components/navigation/view-nav.tsx`);

  it('ViewNav is link-based, URL-backed and shares the tabs look through one style module', () => {
    expect(viewNav).toContain("from '@gold/ui/components/tab-styles'");
    expect(viewNav).toContain("aria-current={view.key === current ? 'page' : undefined}");
    expect(viewNav).not.toContain("'use client'");
    expect(read(`${UI}/tabs.tsx`)).toContain('tabsTriggerClassName');
    expect(read(`${UI}/tab-styles.ts`)).toContain('aria-[current=page]:border-accent');
  });

  it('Customers and Pipeline remain contextual pages of CRM without a redundant tab strip', () => {
    const list = read(`${ROUTES}/customers/page.tsx`);
    const pipeline = read(`${ROUTES}/customers/pipeline/page.tsx`);
    for (const page of [list, pipeline]) expect(page).not.toMatch(/ViewNav|ViewTabs/);
    expect(() => read(`${WEB_ROOT}/features/crm/customers/customers-view-nav.tsx`)).toThrow();
    expect(code(list)).not.toMatch(/<Link\b/);
  });

  it('Team renders ViewNav for Members, Invitations and Roles, with nothing but views in it', () => {
    const page = read(`${ROUTES}/settings/access/access-page.tsx`);
    expect(page).toContain('<ViewNav');
    expect(page).not.toContain('TeamViewTabs');
    expect(() => read(`${ROUTES}/settings/access/team-view-tabs.tsx`)).toThrow();
    const nav = page.slice(page.indexOf('<ViewNav'), page.indexOf('/>', page.indexOf('views={[')));
    expect(nav).not.toMatch(/Trigger|CreateRoleSheet|<Button/);
  });
});
