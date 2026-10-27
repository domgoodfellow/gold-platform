import { describe, expect, it } from 'vitest';
import { AREAS, WORKSPACES, configTarget, configTargetOffered, workspaceAncestry, areaLabel, areaHref } from '@/lib/navigation';
import { SHELL_SECTION_ORDER, pageNavigation, workspaceNavigation, activeItemKey, inPlatformScope, itemContains, projectedItems, projectShell, projectHeaderUtilities, shellHomeItem, topLevelSections, withAdministration, type ShellInput, type ShellSection } from '@/lib/shell';
import { PLATFORM_CAPABILITIES } from '@/lib/domain/platform/permissions';
import { platformAncestry, platformDestinationsFor, platformHref, platformRouteRequires } from '@/lib/platform-navigation';
import { ALL_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';
import { ROLE_PRESETS } from '@/lib/domain/tenancy/role-presets';
import { projectSettingsNav } from '@/lib/settings-nav';

const ORG = '11111111-1111-4111-8111-111111111111';
const allPlatform = new Set(PLATFORM_CAPABILITIES);
const everyFeature = () => new Set(AREAS.flatMap((area) => area.featureKeys ?? []));
const EVERYTHING_MODULES = ['billing', 'assets', 'automations', 'reporting', 'reception', 'integrations', 'card_payments'];
const gate = (capabilities: readonly Capability[] = ALL_CAPABILITIES, overrides: Partial<ShellInput> = {}): ShellInput => ({
  organizationId: ORG, enabledModules: new Set(EVERYTHING_MODULES), featureAvailability: everyFeature(), capabilities: new Set(capabilities), ...overrides,
});
const project = (capabilities: readonly Capability[] = ALL_CAPABILITIES, overrides: Partial<ShellInput> = {}) => projectShell(gate(capabilities, overrides));
const keys = (sections: ShellSection[]) => projectedItems(sections).map((item) => item.key);
const workspaceKeys = ['workspace-crm', 'workspace-communications', 'workspace-marketing', 'workspace-support', 'workspace-field', 'workspace-finance', 'workspace-automations', 'workspace-ai', 'workspace-studio'];

describe('flat business navigation', () => {
  const sections = project();
  const rows = sections.find((section) => section.key === 'workspaces')!.items;
  it('has Home, Library and Workspaces only, in canonical order', () => {
    expect(sections.map((section) => section.key)).toEqual(SHELL_SECTION_ORDER);
    expect(sections.map((section) => section.label)).toEqual([null, null, 'Workspaces']);
    expect(keys(sections)).toEqual(['home', 'library', ...workspaceKeys]);
    for (const row of rows) {
      expect(row.children).toBeUndefined();
      expect(row.heading).toBeUndefined();
    }
  });
  it('links every row to its real Home and preserves internal field identity', () => {
    const homes = ['crm', 'comms', 'marketing', 'support', 'field', 'finance', 'automations', 'ai', 'studio'];
    expect(rows.map((row) => row.href)).toEqual(homes.map((home) => `/organizations/${ORG}/${home}`));
    expect(rows.find((row) => row.key === 'workspace-field')?.label).toBe('Work');
    expect(areaLabel('work')).toBe('Work items');
    expect(workspaceAncestry(ORG, 'work')).toEqual([{ label: 'Work', href: `/organizations/${ORG}/field` }]);
    expect(WORKSPACES.map((workspace) => workspace.label)).toEqual(['CRM', 'Communications', 'Marketing', 'Support', 'Work', 'Finance', 'Automations', 'AI', 'Studio']);
    expect(rows.map((row) => row.label)).not.toContain('Operations');
  });
  it('keeps Settings and header utilities out of permanent business rows', () => {
    for (const name of ['Settings', 'Team', 'Connections', 'Plan & usage', 'Platform', 'Providers']) {
      expect(projectedItems(sections).map((item) => item.label)).not.toContain(name);
    }
  });
  it.each(ROLE_PRESETS)('never adds Platform for the $key tenant role', (role) => {
    expect(project(role.capabilities).map((section) => section.key)).not.toContain('platform');
  });
  it('does not conjure module or feature gated destinations', () => {
    const none = project(ALL_CAPABILITIES, { enabledModules: new Set(), featureAvailability: new Set() });
    expect(keys(none)).toEqual(['home', 'library', 'workspace-crm', 'workspace-communications', 'workspace-marketing', 'workspace-support', 'workspace-field', 'workspace-finance', 'workspace-ai', 'workspace-studio']);
    const aliases = projectedItems(none).flatMap((item) => item.activeHrefs ?? []);
    expect(aliases).not.toContain(`/organizations/${ORG}/assets`);
    expect(aliases).not.toContain(`/organizations/${ORG}/crm/contacts/stages`);
  });
  it('configuration permission alone does not grant Communications operation', () => {
    expect(keys(project(['integration.manage', 'secret.manage']))).not.toContain('workspace-communications');
    expect(keys(project(['call.place']))).toContain('workspace-communications');
    expect(keys(project(['call.place'], { enabledModules: new Set(), featureAvailability: new Set() }))).not.toContain('workspace-communications');
  });
  it('kernel areas remain independent of modules', () => {
    for (const segment of ['home', 'customers', 'work', 'schedule', 'setup']) {
      expect(AREAS.find((area) => area.segment === segment)?.module).toBeUndefined();
    }
  });
  it('offers starting Homes without records, feature entitlements or arbitrary capabilities', () => {
    const rows = projectedItems(project([], { enabledModules: new Set(), featureAvailability: new Set() }));
    for (const key of ['ai']) {
      expect(rows.find((row) => row.key === `workspace-${key}`)).toMatchObject({ href: `/organizations/${ORG}/${key}` });
      expect(workspaceAncestry(ORG, key)).toEqual([]);
    }
    expect(rows.some((row) => row.key === 'workspace-support')).toBe(false);
    expect(rows.some((row) => row.key === 'workspace-marketing')).toBe(false);
    const support = projectedItems(project(['support.read'], { enabledModules: new Set(), featureAvailability: new Set() }));
    expect(support.find((row) => row.key === 'workspace-support')?.href).toBe(`/organizations/${ORG}/support`);
    expect(workspaceAncestry(ORG, 'support')).toEqual([]);
  });
});

describe('owning workspace stays active on contextual and detail routes', () => {
  const sections = project();
  it.each([
    ['home', 'home'], ['library/files', 'library'],
    ['crm', 'workspace-crm'], ['crm/contacts', 'workspace-crm'], ['crm/contacts/customer-1', 'workspace-crm'], ['crm/contacts/stages', 'workspace-crm'],
    ['comms', 'workspace-communications'], ['calls/call-1', 'workspace-communications'], ['comms/inbox/conversation-1', 'workspace-communications'], ['comms/configuration/numbers/number-1', 'workspace-communications'],
    ['marketing', 'workspace-marketing'], ['support', 'workspace-support'], ['ai', 'workspace-ai'],
    ['finance/invoices/invoice-1', 'workspace-finance'], ['finance/payments/payment-1', 'workspace-finance'],
    ['automations/activity', 'workspace-automations'], ['automations/rule-1', 'workspace-automations'],
    ['field', 'workspace-field'], ['work/work-1', 'workspace-field'], ['schedule/date', 'workspace-field'], ['resources/person-1', 'workspace-field'], ['locations/site-1', 'workspace-field'], ['assets/asset-1', 'workspace-field'],
    ['studio/forms/form-1', 'workspace-studio'],
  ])('%s activates %s', (path, key) => {
    expect(activeItemKey(sections, `/organizations/${ORG}/${path}`)).toBe(key);
    expect(activeItemKey(sections, `/organizations/${ORG}/${path}/?tab=details#top`)).toBe(key);
  });
  it('does not match similar prefixes, another tenant or configuration', () => {
    for (const path of ['customers-other', 'settings/access', 'settings/connections', 'platform/providers']) {
      expect(activeItemKey(sections, `/organizations/${ORG}/${path}`)).toBeNull();
    }
    expect(activeItemKey(sections, '/organizations/other/work/1')).toBeNull();
  });
  it('compares alias specificity and lets a later page win its heading tie', () => {
    const sections: ShellSection[] = [{ key: 'workspaces', label: null, items: [
      { key: 'first', label: 'First', href: '/first', section: 'workspaces', activeHrefs: ['/a/b'] },
      { key: 'second', label: 'Second', href: '/second', section: 'workspaces', activeHrefs: ['/a'] },
    ] }];
    expect(activeItemKey(sections, '/a/b/detail')).toBe('first');
    const administration = workspaceNavigation(withAdministration(project(), ORG, allPlatform), platformHref(ORG, 'catalog'))!.sections;
    expect(activeItemKey(administration, platformHref(ORG, 'catalog'))).toBe('platform-products');
  });
});

describe('Work follows the declared shape and entitlement', () => {
  const field = (schedulableWork?: boolean, overrides: Partial<ShellInput> = {}) => projectedItems(project(['field.manage'], { schedulableWork, ...overrides })).find((item) => item.key === 'workspace-field')!;
  it('keeps schedule-dependent aliases only where the work shape allows them', () => {
    const paths = (scheduled?: boolean) => field(scheduled).activeHrefs!.filter(href => !href.includes('configuration')).map((href) => href.split('/').at(-1));
    expect(paths(true)).toEqual(['field', 'work', 'calendar', 'schedule', 'resources', 'locations', 'assets']);
    expect(paths(false)).toEqual(['field', 'work', 'calendar', 'assets']);
    expect(paths(undefined)).toEqual(paths(true));
    expect(field(false, { enabledModules: new Set(), featureAvailability: new Set() }).activeHrefs?.filter(href => !href.includes('configuration'))).toEqual([`/organizations/${ORG}/field`, `/organizations/${ORG}/work`, `/organizations/${ORG}/field/calendar`]);
  });
  it('configuration eligibility keeps the same shape gate', () => {
    expect(configTargetOffered(configTarget('schedule-configuration'), gate(['field.manage'], { schedulableWork: false }))).toBe(false);
    expect(configTargetOffered(configTarget('schedule-configuration'), gate(['field.manage'], { schedulableWork: true }))).toBe(true);
    expect(configTargetOffered(configTarget('work-configuration'), gate(['field.manage'], { schedulableWork: false }))).toBe(true);
  });
});

describe('persistent header utility authority', () => {
  it.each([
    [[], []], [['role.manage'], ['team']], [['integration.manage'], ['connections']],
    [['secret.manage'], ['connections']], [['role.manage', 'secret.manage'], ['team', 'connections']],
  ] as [Capability[], string[]][])('capabilities %j offer %j', (capabilities, expected) => {
    expect(projectHeaderUtilities(gate(capabilities)).map((item) => item.key)).toEqual(expected);
  });
  it('requires the existing integrations entitlement but secrets authority needs no module', () => {
    const absent = { enabledModules: new Set<string>(), featureAvailability: new Set<string>() };
    expect(projectHeaderUtilities(gate(['integration.manage'], absent))).toEqual([]);
    expect(projectHeaderUtilities(gate(['secret.manage'], absent)).map((item) => item.key)).toEqual(['connections']);
  });
  it('links directly to canonical Team and Connections and offers no Settings gear', () => {
    expect(projectHeaderUtilities(gate())).toEqual([
      { key: 'team', label: 'Team', href: `/organizations/${ORG}/settings/access` },
      { key: 'connections', label: 'Connections', href: `/organizations/${ORG}/settings/connections` },
    ]);
  });
});

describe('Administration inside GildOps', () => {
  const gildops = withAdministration(project(), ORG, allPlatform);
  const entry = (sections = gildops) => projectedItems(sections).find((item) => item.key === 'administration');
  const row = (key: string, sections = gildops) => projectedItems(sections).find((item) => item.key === key);

  it('adds one private entry after the workspaces and leaves every workspace row flat', () => {
    expect(gildops.map((section) => section.key)).toEqual([...SHELL_SECTION_ORDER, 'administration']);
    expect(gildops.at(-1)!.items.map((item) => item.key)).toEqual(['administration']);
    expect(keys(gildops).filter((key) => key === 'administration')).toHaveLength(1);
    expect(gildops.find((section) => section.key === 'workspaces')!.items.map((item) => item.key)).toEqual(workspaceKeys);
    expect(entry()!.children).toBeUndefined();
    expect(entry()!.contextOnly).toBeUndefined();
    expect(entry()!.href).toBe(platformHref(ORG));
    expect(topLevelSections(gildops)).toEqual(gildops);
  });
  it('opens the agreed Administration groups, with Commercial administration among them', () => {
    expect(entry()!.destinations?.map((item) => item.label)).toEqual(['Overview', 'Organizations', 'Product Registry', 'Integration Registry', 'Infrastructure', 'Reliability', 'Commercial administration']);
    const commercial = entry()!.destinations!.find((item) => item.key === 'platform-group-commercial')!;
    expect(commercial.children?.map((item) => item.key)).toEqual(['platform-plans', 'platform-pricing', 'platform-usage-economics', 'platform-vendor-rates', 'platform-package-economics', 'platform-portfolio-economics', 'platform-billing']);
  });
  it('links AI to AI Runtime and never links Finance to Commercial administration', () => {
    // Finance is the tenant's own ledger; GildOps' commercial control is reached from Administration only (ADR-051).
    expect(row('workspace-finance')?.administration).toBeUndefined();
    expect(row('workspace-ai')?.administration).toEqual({ key: 'platform-link-ai-runtime', label: 'AI Runtime', href: platformHref(ORG, 'ai-runtime'), section: 'workspaces' });
    expect(projectedItems(workspaceNavigation(gildops, `/organizations/${ORG}/finance`)!.sections).map((item) => item.key)).not.toContain('platform-link-commercial');
    expect(workspaceNavigation(gildops, platformHref(ORG, 'plans/base'))?.workspace.key).toBe('administration');
    expect(workspaceNavigation(gildops, platformHref(ORG, 'ai-runtime'))?.workspace.key).toBe('administration');
  });
  it('adds nothing without a platform permission', () => {
    expect(withAdministration(project(), ORG, new Set())).toEqual(project());
  });
  it('offers commercial-only staff an Administration row and no Finance link', () => {
    const commercial = withAdministration(project(), ORG, new Set(['platform.commercial']));
    expect(row('workspace-finance', commercial)?.administration).toBeUndefined();
    expect(entry(commercial)?.contextOnly).toBeUndefined();
    expect(projectedItems(topLevelSections(commercial)).map((item) => item.key)).toContain('administration');
    const context = workspaceNavigation(commercial, platformHref(ORG, 'pricing'))!;
    expect(context.workspace.key).toBe('administration');
    expect(activeItemKey(context.sections, platformHref(ORG, 'pricing'))).toBe('platform-pricing');
  });
  it('offers provider-only staff Infrastructure and their AI link, never Commercial', () => {
    const providers = withAdministration(project(), ORG, new Set(['platform.providers']));
    expect(entry(providers)!.destinations?.map((item) => item.label)).toEqual(['Infrastructure']);
    expect(entry(providers)!.contextOnly).toBeUndefined();
    expect(entry(providers)!.href).toBe(platformHref(ORG, 'providers'));
    expect(row('workspace-finance', providers)?.administration).toBeUndefined();
    expect(row('workspace-ai', providers)?.administration?.key).toBe('platform-link-ai-runtime');
  });
  it('draws the Administration row for commercial authority when no Finance is in the shell to link from', () => {
    const noFinance = withAdministration(project().map((section) => ({ ...section, items: section.items.filter((item) => item.key !== 'workspace-finance') })), ORG, new Set(['platform.commercial']));
    expect(entry(noFinance)?.contextOnly).toBeUndefined();
    expect(entry(noFinance)?.destinations?.map((item) => item.label)).toEqual(['Commercial administration']);
  });
  it.each(PLATFORM_CAPABILITIES)('partial %s authority offers only its own destinations', (permission) => {
    const partial = withAdministration(project(), ORG, new Set([permission]));
    const allowed = platformDestinationsFor(new Set([permission])).map((item) => platformHref(ORG, item.path));
    const offered = projectedItems(partial).flatMap((item) => [item, ...(item.destinations ?? []), ...(item.administration ? [item.administration] : [])])
      .flatMap(function walk(item): string[] { return [item.href, ...(item.children ?? []).flatMap(walk)]; })
      .filter((href) => href.startsWith(platformHref(ORG)));
    expect(new Set(offered)).toEqual(new Set(allowed));
  });
  it('enters Administration as a context with a way back, at any nested address', () => {
    const context = workspaceNavigation(gildops, platformHref(ORG, 'providers/twilio'))!;
    expect(context.workspace.key).toBe('administration');
    expect(context.backHref).toBe(`/organizations/${ORG}/home`);
    expect(context.sections.map((section) => section.label)).toEqual(['Administration']);
    expect(activeItemKey(context.sections, platformHref(ORG, 'providers/twilio'))).toBe('platform-providers');
    expect(itemContains(context.sections[0].items.find((item) => item.key === 'platform-group-infrastructure')!, 'platform-providers')).toBe(true);
    expect(activeItemKey(context.sections, platformHref(ORG))).toBe('platform-overview');
  });
  it('keeps AI Runtime unrelated to the tenant AI workspace', () => {
    expect(activeItemKey(project(), platformHref(ORG, 'ai-runtime'))).toBeNull();
    expect(workspaceNavigation(gildops, `/organizations/${ORG}/ai`)?.workspace.key).toBe('workspace-ai');
  });
  it('offers no Administration context to a projection without it, or at an address it does not offer', () => {
    expect(workspaceNavigation(project(), platformHref(ORG, 'providers'))).toBeNull();
    expect(workspaceNavigation(withAdministration(project(), ORG, new Set(['platform.providers'])), platformHref(ORG, 'organizations'))).toBeNull();
  });
  it('lands the phone Home control on the business Home, in Administration too', () => {
    expect(shellHomeItem(gildops)?.key).toBe('home');
  });
});

describe('Administration breadcrumbs', () => {
  it('lead with Administration, never the workspace that links in', () => {
    expect(platformAncestry(ORG, 'providers')).toEqual([{ label: 'Administration', href: platformHref(ORG) }, { label: 'Infrastructure' }]);
    expect(platformAncestry(ORG, 'organizations')).toEqual([{ label: 'Administration', href: platformHref(ORG) }]);
    expect(platformAncestry(ORG, 'pricing')).toEqual([{ label: 'Administration', href: platformHref(ORG) }, { label: 'Commercial administration' }]);
  });
});

describe('platform routes and their permission', () => {
  it('a path takes the permission of its longest registered prefix', () => {
    // Paths are read beneath the platform root: `platformHref(id, path)` is the only way to spell one.
    expect(platformRouteRequires('')).toBe('platform.health');
    expect(platformRouteRequires('failures')).toBe('platform.health');
    expect(platformRouteRequires('organizations')).toBe('platform.organizations');
    expect(platformRouteRequires('organizations/abc/providers')).toBe('platform.organizations');
    // Plans & Add-ons and portfolio economics are the commercial plane's, not the catalogue's.
    expect(platformRouteRequires('plans/base')).toBe('platform.commercial');
    expect(platformRouteRequires('economics/abc')).toBe('platform.commercial');
    expect(platformRouteRequires('integrations/new')).toBe('platform.catalogue');
    expect(platformRouteRequires('pricing')).toBe('platform.commercial');
    expect(platformRouteRequires('billing')).toBe('platform.commercial');
    expect(platformRouteRequires('providers/twilio/configure')).toBe('platform.providers');
  });

  it('refuses a path nobody classified, rather than serving it', () => {
    expect(platformRouteRequires('something-new')).toBe('platform.health');
  });

  it('spells every Platform address under the organization the operator is working in, and recognises only those', () => {
    const gold = '11111111-1111-4111-8111-111111111111';
    expect(platformHref(gold)).toBe(`/platform`);
    expect(platformHref(gold, 'catalog/plans')).toBe(`/platform/catalog/plans`);
    expect(inPlatformScope(platformHref(gold, 'billing'))).toBe(true);
    expect(inPlatformScope('/platform/billing')).toBe(true);
  });

  it('every permission reaches at least one destination, so none is a permission that opens nothing', () => {
    for (const capability of PLATFORM_CAPABILITIES) {
      expect(platformDestinationsFor(new Set([capability])).length, capability).toBeGreaterThan(0);
    }
  });
});

describe('role presets are templates, not personas', () => {
  it('name only capabilities that exist, so a preset cannot mint an authority', () => {
    for (const candidate of ROLE_PRESETS) {
      for (const capability of candidate.capabilities) expect(ALL_CAPABILITIES).toContain(capability);
      expect(new Set(candidate.capabilities).size, candidate.key).toBe(candidate.capabilities.length);
    }
  });

  it('carry no reference a saved role could keep: keys are unique and nothing branches on them', () => {
    expect(new Set(ROLE_PRESETS.map((candidate) => candidate.key)).size).toBe(ROLE_PRESETS.length);
  });
});


describe('contextual workspace navigation', () => {
  it.each(WORKSPACES)('enters $label through its canonical Home and returns to organization Home', (workspace) => {
    const context = workspaceNavigation(project(), areaHref(ORG, workspace.home))!;
    expect(context.workspace.key).toBe(`workspace-${workspace.key}`);
    expect(context.backHref).toBe(`/organizations/${ORG}/home`);
    expect(context.sections[0].label).toBe(workspace.label);
    // ADR-049: one explicit Dashboard owns the landing route; identity is not a link.
    const home = areaHref(ORG, workspace.home);
    expect(context.sections[0].href).toBeUndefined();
    expect(context.sections[0].items.filter(item => item.href === home)).toEqual([expect.objectContaining({ key: 'workspace-dashboard', label: 'Dashboard', exact: true })]);
    expect(activeItemKey(context.sections, home)).toBe('workspace-dashboard');
    const expected = AREAS.filter((area) => area.workspace === workspace.key && area.sidebar !== false && area.segment !== workspace.home);
    expect(context.sections[0].items.filter(item => item.key !== 'workspace-configuration' && !item.key.startsWith('platform-')).map((item) => item.key)).toEqual(['workspace-dashboard', ...expected.map((area) => area.segment)]);
  });
  it.each([
    ['crm/contacts/123', 'crm', 'customers'], ['crm/contacts/stages', 'crm', 'customers'],
    ['calls/123', 'communications', 'calls'], ['comms/inbox/123', 'communications', 'comms-inbox'],
    ['finance/invoices/123', 'finance', 'finance-invoices'], ['automations/rules/123', 'automations', 'automation-rules'],
    ['work/dispatch', 'field', 'work'], ['studio/forms/123', 'studio', 'studio-forms'],
  ])('resolves %s with a single active destination', (path, owner, active) => {
    const href = `/organizations/${ORG}/${path}/?tab=x#top`;
    const context = workspaceNavigation(project(), href)!;
    expect(context.workspace.key).toBe(`workspace-${owner}`);
    expect(activeItemKey(context.sections, href)).toBe(active);
  });
  it('retains hidden operating ownership without exposing hidden or configuration destinations', () => {
    const context = workspaceNavigation(project(), `/organizations/${ORG}/crm/opportunities/123`)!;
    expect(context.workspace.key).toBe('workspace-crm');
    expect(context.sections[0].items.map((item) => item.key)).not.toContain('opportunities');
    for (const path of ['home', 'library', 'pricing', 'platform/providers', 'customers-other']) {
      expect(workspaceNavigation(project(), `/organizations/${ORG}/${path}`)).toBeNull();
    }
  });
  it('filters entitlement, role, readiness and shape before rendering destinations or entering context', () => {
    const reduced = project([], { enabledModules: new Set(), featureAvailability: new Set(), schedulableWork: false });
    for (const path of ['comms', 'calls/123', 'customers/pipeline', 'finance/invoices/123', 'schedule', 'studio/forms', 'support', 'automations/rules']) {
      expect(workspaceNavigation(reduced, `/organizations/${ORG}/${path}`), path).toBeNull();
    }
    // Dashboard is available only while the registered Work landing is operable.
    expect(workspaceNavigation(reduced, `/organizations/${ORG}/field`)!.sections[0]).toMatchObject({ label: 'Work' });
    expect(workspaceNavigation(reduced, `/organizations/${ORG}/field`)!.sections[0].items.map((item) => item.key)).toEqual(['workspace-dashboard', 'work']);
  });
  it('does not carry workspace selection into another organization or organization Home', () => {
    expect(workspaceNavigation(project(), '/organizations/other/crm/contacts/123')).toBeNull();
    const switched = project(ALL_CAPABILITIES, { organizationId: '22222222-2222-4222-8222-222222222222' });
    expect(workspaceNavigation(switched, '/organizations/22222222-2222-4222-8222-222222222222/crm/contacts/123')!.backHref).toBe('/organizations/22222222-2222-4222-8222-222222222222/home');
    expect(workspaceNavigation(switched, '/organizations/other/home')).toBeNull();
  });
});


describe('responsive page-location projection', () => {
  const base = `/organizations/${ORG}`;
  const navigation = { organizationId: ORG, sections: project() };
  it('uses organization Home for workspace overview and no parent at organization Home', () => {
    expect(pageNavigation(navigation, `${base}/field`, []).parentHref).toBe(`${base}/home`);
    expect(pageNavigation(navigation, `${base}/home`, []).parentHref).toBeUndefined();
  });
  it('resolves Work independently of its internal field key and uses registered hrefs', () => {
    const location = pageNavigation(navigation, `${base}/schedule`, []);
    expect(location.parentHref).toBe(`${base}/field`);
    expect(location.groups[0].label).toBe('Work');
    // The mobile group names the workspace and offers Dashboard as a normal item.
    expect(location.groups[0].href).toBeUndefined();
    expect(location.groups[0].items.some((item) => item.href === `${base}/field`)).toBe(true);
    expect(location.groups[0].items.some((item) => item.href === `${base}/work`)).toBe(true);
    expect(location.activeKey).toBe('schedule');
  });
  it('uses the Work Items collection for a direct detail and retains explicit filtered ancestors', () => {
    expect(pageNavigation(navigation, `${base}/work/record-id`, []).parentHref).toBe(`${base}/work`);
    expect(pageNavigation(navigation, `${base}/work/record-id`, [`${base}/field`, `${base}/work?status=open`]).parentHref).toBe(`${base}/work?status=open`);
  });
  it('keeps dynamic records out of the destination model', () => {
    const location = pageNavigation(navigation, `${base}/assets/record-id`, []);
    expect(location.parentHref).toBe(`${base}/assets`);
    expect(location.groups.flatMap((group) => group.items).some((item) => item.href.endsWith('/record-id'))).toBe(false);
  });
  it('uses only authorized ancestors and rejects foreign context and external URLs', () => {
    const foreign = '/organizations/22222222-2222-4222-8222-222222222222/home';
    expect(pageNavigation(navigation, `${base}/field`, [foreign, 'https://example.test', '//example.test']).parentHref).toBe(`${base}/home`);
    expect(pageNavigation(navigation, foreign, [])).toEqual({ activeKey: null, groups: [] });
  });
  it('restricted and unresolved locations never fabricate workspace destinations', () => {
    expect(pageNavigation({ organizationId: ORG, sections: [] }, `${base}/settings/plan`, [])).toEqual({ activeKey: null, groups: [] });
    expect(pageNavigation(navigation, `${base}/unknown`, []).groups).toEqual([]);
    expect(pageNavigation(navigation, `${base}/unknown`, []).parentHref).toBe(`${base}/home`);
  });
  it('keeps entitlement-hidden Areas out of the menu and does not infer their workspace', () => {
    const limited = { organizationId: ORG, sections: project(ALL_CAPABILITIES, { enabledModules: new Set(), featureAvailability: new Set() }) };
    expect(pageNavigation(limited, `${base}/assets`, []).groups).toEqual([]);
    expect(pageNavigation(limited, `${base}/field`, []).groups.flatMap((group) => group.items).some((item) => item.key === 'assets')).toBe(false);
  });
  it('offers Marketing its Home as the heading and four operating pages, and keeps a campaign under Campaigns', () => {
    const location = pageNavigation(navigation, `${base}/marketing/campaigns/campaign-1`, []);
    // Marketing retains identity plus an explicit Dashboard before its operational pages.
    expect(location.groups[0]).toMatchObject({ label: 'Marketing' });
    expect(location.groups.flatMap((group) => group.items).map((item) => item.key)).toEqual(['workspace-dashboard', 'marketing-campaigns', 'marketing-audiences', 'marketing-leads', 'marketing-performance']);
    expect(location.activeKey).toBe('marketing-campaigns');
  });
  it('uses the restricted Settings projection without adding tenant workspaces', () => {
    const settings = { organizationId: ORG, sections: projectSettingsNav(ORG, gate([])) };
    const location = pageNavigation(settings, '/settings/account/security', []);
    expect(location.activeKey).toBe('settings-security');
    expect(location.groups.flatMap((group) => group.items).map((item) => item.key)).toEqual(['settings-profile', 'settings-security', 'settings-appearance']);
    expect(location.groups.flatMap((group) => group.items).every((item) => item.href.includes(ORG))).toBe(true);
    expect(location.parentHref).toBeUndefined();
  });
  it('uses the authorized configuration registry for nested parents and workspace ownership', () => {
    const configuration = { ...navigation, configurationHrefs: [`${base}/work/configuration`] };
    expect(pageNavigation(configuration, `${base}/work/configuration/type-id`, []).parentHref).toBe(`${base}/work/configuration`);
    expect(pageNavigation(configuration, `${base}/work/configuration`, []).groups[0].label).toBe('Work');
  });
  it('adapts Administration grouping without exposing tenant workspaces', () => {
    const administration = { organizationId: ORG, sections: withAdministration(project(), ORG, new Set(['platform.providers'])) };
    const location = pageNavigation(administration, platformHref(ORG, 'providers/twilio'), []);
    expect(location.parentHref).toBe(platformHref(ORG, 'providers'));
    expect(location.groups.map((group) => group.label)).toEqual(['Infrastructure']);
    expect(location.groups.flatMap((group) => group.items).every((item) => item.href.startsWith(platformHref(ORG)))).toBe(true);
    expect(location.groups.flatMap((group) => group.items).some((item) => item.key === 'workspace-field')).toBe(false);
  });
  it('keeps commercial pages in an Administration dropdown, never Finance', () => {
    const gildops = { organizationId: ORG, sections: withAdministration(project(), ORG, new Set(['platform.commercial'])) };
    const location = pageNavigation(gildops, platformHref(ORG, 'pricing'), []);
    expect(location.groups.map((group) => group.label)).toEqual(['Commercial administration']);
    expect(location.activeKey).toBe('platform-pricing');
  });
});


describe('workspace Configuration authority', () => {
  it('lets a configuration-only member enter without Overview, Calls or Inbox', () => {
    const sections = project(['field.manage']);
    const row = projectedItems(sections).find(item => item.key === 'workspace-communications')!;
    // The row opens the first configuration page directly, never the redirect-only address.
    expect(row.href).toBe(`/organizations/${ORG}/comms/configuration/calling`);
    expect(row.configurationOnly).toBe(true);
    const context = workspaceNavigation(sections, row.href)!;
    expect(context.sections[0].items.map(item => item.key)).toEqual(['workspace-configuration']);
    // ADR-047: the heading links to the operating Home only for someone who may use it.
    expect(context.sections[0].href).toBeUndefined();
    expect(workspaceNavigation(sections, `/organizations/${ORG}/calls`)).toBeNull();
    expect(workspaceNavigation(sections, `/organizations/${ORG}/comms/inbox`)).toBeNull();
    expect(activeItemKey(context.sections, `/organizations/${ORG}/comms/configuration/calling`)).toBe('call-setup');
  });
  it('does not offer Configuration to a calling-only member or without an accessible concern', () => {
    const row = projectedItems(project(['call.place'])).find(item => item.key === 'workspace-communications')!;
    expect(row.configuration).toBeUndefined();
    expect(workspaceNavigation(project(['call.place']), `/organizations/${ORG}/comms/configuration`)).toBeNull();
    const none = project(['field.manage'], { enabledModules: new Set(), featureAvailability: new Set() });
    expect(projectedItems(none).find(item => item.key === 'workspace-communications')).toBeUndefined();
    for (const key of ['marketing', 'automations']) expect(projectedItems(project()).find(item => item.key === `workspace-${key}`)?.configuration).toBeUndefined();
  });
  it('cannot infer a restricted configuration section from an authorized configuration root', () => {
    const sections = project(['field.manage']);
    expect(workspaceNavigation(sections, `/organizations/${ORG}/comms/configuration/calling`)).not.toBeNull();
    expect(workspaceNavigation(sections, `/organizations/${ORG}/comms/configuration/email`)).toBeNull();
    expect(workspaceNavigation(sections, `/organizations/${ORG}/comms/configuration/numbers`)).toBeNull();
  });
  it('keeps Configuration active on its authorized legacy and canonical section addresses', () => {
    for (const [suffix, active] of [['comms/configuration', 'workspace-configuration'], ['comms/configuration/calling', 'call-setup'], ['comms/configuration/email', 'inbox-email']]) {
      const path = `/organizations/${ORG}/${suffix}`;
      const context = workspaceNavigation(project(), path)!;
      expect(context.workspace.key).toBe('workspace-communications');
      expect(activeItemKey(context.sections, path)).toBe(active);
      expect(context.sections[0].items.filter(item => item.key === 'workspace-configuration')).toHaveLength(1);
    }
  });
});


describe('CRM Configuration children', () => {
  it('uses eligible registry destinations and selects the deepest child on direct access', () => {
    const sections = project();
    const parent = projectedItems(sections).find(item => item.key === 'workspace-crm')!.configuration!;
    expect(parent.children?.map(item => item.label)).toEqual(['Relationship stages', 'Opportunity stages', 'Customer fields']);
    for (const child of parent.children!) {
      const context = workspaceNavigation(sections, child.href)!;
      expect(activeItemKey(context.sections, child.href)).toBe(child.key);
      expect(activeItemKey(context.sections, `${child.href}/record`)).toBe(child.key);
    }
    expect(activeItemKey(workspaceNavigation(sections, parent.href)!.sections, parent.href)).toBe('workspace-configuration');
  });
  it('omits unentitled and unauthorized children independently of operating access', () => {
    const limited = projectedItems(project(['field.manage'], { enabledModules: new Set(), featureAvailability: new Set() })).find(item => item.key === 'workspace-crm')!.configuration!;
    expect(limited.children?.map(item => item.key)).toEqual(['opportunity-stages', 'customer-fields']);
    expect(projectedItems(project(['customer.create'])).find(item => item.key === 'workspace-crm')?.configuration).toBeUndefined();
  });
});


describe('every workspace Configuration organizes its real pages', () => {
  it('draws one page as a direct link and several as a group that never links to a landing', () => {
    const rows = projectedItems(project()).filter(item => item.configuration);
    expect(rows.length).toBeGreaterThan(1);
    // Finance has no Configuration row at all (Structural Correction A1).
    expect(rows.find(row => row.key === 'workspace-finance')).toBeUndefined();
    for (const single of rows.filter(row => !row.configuration!.children)) expect(single.configuration!.group, single.key).toBeUndefined();
    for (const row of rows) {
      const parent = row.configuration!;
      if (!parent.children) { expect(parent.href, row.key).not.toMatch(/\/configuration$/); continue; }
      expect(parent.group, row.key).toBe(true);
      expect(parent.children.length, row.key).toBeGreaterThan(1);
      for (const child of parent.children!) {
        expect(child.href.startsWith(`/organizations/${ORG}/`), child.key).toBe(true);
        const context = workspaceNavigation(project(), child.href);
        if (!context) { expect(child.href, `${child.key} is a shared Settings page`).toContain('/settings/'); continue; }
        expect(activeItemKey(context.sections, child.href.split('#')[0]), child.key).toMatch(new RegExp(`^(${parent.children!.map(item => item.key.replace(/#.*/, '')).join('|')}|workspace-configuration)$`));
      }
    }
  });
});

describe('workspace calendars', () => {
  it('retains each workspace context and introduces no standalone calendar sidebar item', () => {
    const sections = project();
    expect(projectedItems(sections).some(item => item.key.includes('calendar'))).toBe(false);
    for (const workspace of WORKSPACES) {
      const context = workspaceNavigation(sections, `${areaHref(ORG, workspace.home)}/calendar`);
      expect(context?.workspace.key).toBe(`workspace-${workspace.key}`);
    }
  });
});

describe('Support workspace navigation', () => {
  const base = `/organizations/${ORG}/support`;
  // ADR-047: Support's Home is its heading, so the operating destinations no longer begin with an Overview child.
  const operating = ['support-cases', 'support-queue-workbench', 'support-service-levels-view', 'support-reports'];
  const readOnly = () => project(['support.read'], { enabledModules: new Set(), featureAvailability: new Set() });
  it('shows the workspace row on Home, not its pages', () => {
    const sections = project();
    const top = sections.flatMap((section) => section.items.map((item) => item.key));
    expect(top).toContain('workspace-support');
    expect(top).not.toContain('support-cases');
    expect(top).not.toContain('support-queue-workbench');
  });
  it('replaces the directory with exactly the operating destinations when somebody enters Support', () => {
    expect(workspaceNavigation(project(), base)!.sections[0].items.map((item) => item.key)).toEqual(['workspace-dashboard', ...operating]);
    expect(workspaceNavigation(readOnly(), base)!.sections[0].items.map((item) => item.key)).toEqual(['workspace-dashboard', ...operating]);
    expect(workspaceNavigation(project(), base)!.backHref).toBe(`/organizations/${ORG}/home`);
    expect(workspaceNavigation(project(), base)!.sections[0].href).toBeUndefined();
  });
  it.each([
    [`${base}/cases`, 'support-cases'],
    [`${base}/cases/case-1`, 'support-cases'],
    [`${base}/queues`, 'support-queue-workbench'],
    [`${base}/service-levels`, 'support-service-levels-view'],
    [`${base}/reports`, 'support-reports'],
    [`${base}/configuration/queues`, 'support-queue-workbench'],
    [`${base}/configuration/service-levels`, 'support-service-levels-view'],
  ])('selects the destination that owns %s', (path, key) => {
    const context = workspaceNavigation(project(), path)!;
    expect(context, path).not.toBeNull();
    expect(activeItemKey(context.sections, path)).toBe(key);
  });
  it('keeps Support selected across detail, configuration and refresh, since each is the same address', () => {
    const sections = project();
    expect(workspaceNavigation(sections, `${base}/cases/case-1?from=2026-01-01`)!.sections).toEqual(workspaceNavigation(sections, `${base}/cases`)!.sections);
  });
  it('draws no separate Configuration branch: Queues and Service levels are destinations', () => {
    const row = projectedItems(project()).find((item) => item.key === 'workspace-support')!;
    expect(row.configuration).toBeUndefined();
    expect(keys(project())).not.toContain('workspace-configuration');
  });
  it('keeps configuration deep links on their destination for a member who may configure', () => {
    const sections = project();
    const destinations = projectedItems(sections).find((item) => item.key === 'workspace-support')!.destinations!;
    expect(destinations.find((item) => item.key === 'support-queue-workbench')?.activeHrefs).toEqual([`/organizations/${ORG}/support/configuration/queues`]);
    expect(destinations.find((item) => item.key === 'support-service-levels-view')?.activeHrefs).toEqual([`/organizations/${ORG}/support/configuration/service-levels`]);
  });
  it('gives a read-only member no configuration context beyond the operating views', () => {
    const sections = readOnly();
    expect(keys(sections)).toContain('workspace-support');
    expect(workspaceNavigation(sections, base)!.sections[0].items.map((item) => item.key)).toEqual(['workspace-dashboard', ...operating]);
    expect(workspaceNavigation(sections, `${base}/configuration/queues`)!.sections[0].items.map((item) => item.key)).toEqual(['workspace-dashboard', ...operating]);
  });
  it('does not reveal Support to a member without support.read', () => {
    const none = project([], { enabledModules: new Set(), featureAvailability: new Set() });
    expect(keys(none)).not.toContain('workspace-support');
    expect(workspaceNavigation(none, base)).toBeNull();
    expect(workspaceNavigation(none, `${base}/cases`)).toBeNull();
  });
});

// ADR-048 retired the header destination strip; the entered-workspace sidebar owns workspace
// navigation. The strip's own presentation tests went with it. What they also protected — which
// destinations each role reaches and which one is current — is kept here against the projection
// the sidebar draws.
describe('entered-workspace destinations by role', () => {
  const base = `/organizations/${ORG}`;
  const destinations = (capabilities: readonly Capability[], path: string) => {
    const context = workspaceNavigation(project(capabilities), `${base}/${path}`);
    return context?.sections[0].items.filter((item) => !item.children && !item.key.startsWith('platform-')).map((item) => item.key);
  };
  it('gives a read-only AI member only the member pages, and keeps agent configuration out of its pages', () => {
    expect(destinations([], 'ai')).toEqual(['workspace-dashboard', 'ai-activity', 'ai-evaluations']);
    expect(activeItemKey(workspaceNavigation(project(), `${base}/ai/evaluations`)!.sections, `${base}/ai/evaluations`)).toBe('ai-evaluations');
  });
  it('keeps calling-only and messaging-only Communications distinct', () => {
    expect(destinations(['call.place'], 'comms')).toEqual(['workspace-dashboard', 'calls']);
    expect(destinations(['message.send'], 'comms')).toEqual(['workspace-dashboard', 'comms-inbox']);
  });
  it('keeps detail routes on their destination for Finance and Support, and Studio pages for managers only', () => {
    expect(activeItemKey(workspaceNavigation(project(), `${base}/finance/invoices/invoice-1`)!.sections, `${base}/finance/invoices/invoice-1`)).toBe('finance-invoices');
    expect(activeItemKey(workspaceNavigation(project(), `${base}/support/cases/case-1`)!.sections, `${base}/support/cases/case-1`)).toBe('support-cases');
    expect(destinations(ALL_CAPABILITIES, 'studio')).toEqual(['workspace-dashboard', 'studio-website', 'studio-portal', 'studio-forms', 'studio-templates']);
    expect(destinations([], 'studio')).toEqual(['workspace-dashboard']);
  });
});

describe('workspace Calendar shortcut', () => {
  const base = `/organizations/${ORG}`;
  const registered = new Set(AREAS.map((area) => `${base}/${area.route ?? area.segment}`));
  it.each(WORKSPACES)('offers $label its registered calendar, beneath its Home', (workspace) => {
    const row = projectedItems(project()).find((item) => item.key === `workspace-${workspace.key}`);
    if (!row || row.configurationOnly) return;
    expect(row.calendar, workspace.key).toBeDefined();
    expect(row.calendar!.href).toBe(`${row.href}/calendar`);
    // Never built from a string: the address is a registered destination.
    expect(registered.has(row.calendar!.href)).toBe(true);
  });
  it('offers no calendar to a workspace whose Home this person cannot use', () => {
    const row = projectedItems(project(['field.manage'])).find((item) => item.key === 'workspace-communications')!;
    expect(row.configurationOnly).toBe(true);
    expect(row.calendar).toBeUndefined();
  });
  it('offers no calendar for a workspace that is not part of the business', () => {
    const reduced = project([], { enabledModules: new Set(), featureAvailability: new Set() });
    expect(projectedItems(reduced).find((item) => item.key === 'workspace-communications')?.calendar).toBeUndefined();
  });
  it('reaches the calendar from inside the workspace and keeps the workspace context there', () => {
    const context = workspaceNavigation(project(), `${base}/crm/calendar`)!;
    expect(context.workspace.key).toBe('workspace-crm');
    expect(context.workspace.calendar?.href).toBe(`${base}/crm/calendar`);
  });
});

describe('Organization Settings: one authoritative editor per setting', () => {
  const labels = (capabilities: readonly Capability[], overrides: Partial<ShellInput> = {}) => projectSettingsNav(ORG, gate(capabilities, overrides)).find(section => section.key === 'settings-organization')?.items.map(item => item.label) ?? [];
  it('gives customer payments and business words their own pages beside General', () => {
    expect(labels(['organization.manage', 'feature.manage'])).toEqual(['General', 'Customer payments', 'Branding', 'Domains', 'Email sending', 'Features', 'Words & navigation']);
  });
  it('offers Customer payments only to a business that bills, and neither page to a member who cannot manage the business', () => {
    expect(labels(['organization.manage'], { enabledModules: new Set(), featureAvailability: new Set() })).not.toContain('Customer payments');
    expect(labels(['organization.manage'], { enabledModules: new Set(), featureAvailability: new Set() })).toContain('Words & navigation');
    expect(labels(['feature.manage'])).toEqual(['Features']);
  });
  it('keeps payment collection out of Plan & usage, the GildOps subscription', () => {
    const administration = projectSettingsNav(ORG, gate()).find(section => section.key === 'settings-administration')!.items;
    expect(administration.find(item => item.label === 'Plan & usage')?.href).toBe(`/organizations/${ORG}/settings/plan`);
    expect(administration.map(item => item.href)).not.toContain(`/organizations/${ORG}/settings/payments`);
  });
});
