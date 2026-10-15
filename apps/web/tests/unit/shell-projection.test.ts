import { describe, expect, it } from 'vitest';
import { AREAS, WORKSPACES, configTarget, configTargetOffered, workspaceAncestry, areaLabel } from '@/lib/navigation';
import { SHELL_SECTION_ORDER, pageNavigation, workspaceNavigation, activeItemKey, inPlatformScope, itemContains, projectedItems, projectShell, projectPlatformShell, projectHeaderUtilities, selectShellContext, shellHomeItem, type ShellInput, type ShellSection } from '@/lib/shell';
import { PLATFORM_CAPABILITIES } from '@/lib/domain/platform/permissions';
import { platformDestinationsFor, platformHref, platformRouteRequires } from '@/lib/platform-navigation';
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
    const homes = ['sales', 'comms', 'marketing', 'support', 'field', 'finance', 'automations', 'ai', 'studio'];
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
    expect(aliases).not.toContain(`/organizations/${ORG}/customers/pipeline`);
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
    ['sales', 'workspace-crm'], ['customers', 'workspace-crm'], ['customers/customer-1', 'workspace-crm'], ['customers/pipeline', 'workspace-crm'],
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
    expect(activeItemKey(projectPlatformShell(ORG, allPlatform), platformHref(ORG, 'catalog'))).toBe('platform-products');
  });
});

describe('Work follows the declared shape and entitlement', () => {
  const field = (schedulableWork?: boolean, overrides: Partial<ShellInput> = {}) => projectedItems(project(['field.manage'], { schedulableWork, ...overrides })).find((item) => item.key === 'workspace-field')!;
  it('keeps schedule-dependent aliases only where the work shape allows them', () => {
    const paths = (scheduled?: boolean) => field(scheduled).activeHrefs!.filter(href => !href.includes('configuration')).map((href) => href.split('/').at(-1));
    expect(paths(true)).toEqual(['field', 'work', 'schedule', 'resources', 'locations', 'assets']);
    expect(paths(false)).toEqual(['field', 'work', 'assets']);
    expect(paths(undefined)).toEqual(paths(true));
    expect(field(false, { enabledModules: new Set(), featureAvailability: new Set() }).activeHrefs?.filter(href => !href.includes('configuration'))).toEqual([`/organizations/${ORG}/field`, `/organizations/${ORG}/work`]);
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

describe('Platform is a separate system projection', () => {
  const sections = projectPlatformShell(ORG, allPlatform);
  it('keeps Platform AI Runtime unrelated to tenant AI', () => {
    expect(activeItemKey(project(), platformHref(ORG, 'ai-runtime'))).toBeNull();
    expect(activeItemKey(sections, `/organizations/${ORG}/ai`)).toBeNull();
    expect(activeItemKey(sections, platformHref(ORG, 'ai-runtime'))).toBe('platform-ai-runtime');
    expect(selectShellContext(ORG, `/organizations/${ORG}/ai`, { organizationId: ORG })).toBe('business');
  });
  it('holds only the existing nested Platform IA', () => {
    expect(sections.map((section) => section.key)).toEqual(['platform']);
    expect(sections[0].label).toBeNull();
    const root = sections[0].items[0];
    expect(root.href).toBe(platformHref(ORG));
    expect(root.children?.map((item) => item.key)).toEqual(['platform-organizations', 'platform-group-catalog', 'platform-group-commercial', 'platform-group-infrastructure']);
    expect(keys(sections)).toContain('platform-providers');
    expect(keys(sections)).toContain('platform-connectors');
    expect(keys(sections)).not.toContain('platform-overview');
    expect(keys(sections)).not.toContain('workspace-crm');
    expect(shellHomeItem(sections)).toBe(root);
    expect(shellHomeItem(project())?.key).toBe('home');
  });
  it('an empty permission set has no system projection', () => {
    expect(projectPlatformShell(ORG, new Set())).toEqual([]);
  });
  it.each(PLATFORM_CAPABILITIES)('partial %s authority projects only permitted pages', (permission) => {
    const partial = projectPlatformShell(ORG, new Set([permission]));
    const allowed = platformDestinationsFor(new Set([permission])).filter((item) => item.path).map((item) => `platform-${item.key}`);
    expect(keys(partial).filter((key) => key !== 'platform' && !key.startsWith('platform-group-'))).toEqual(allowed);
  });
  it('nested detail links retain their group ancestry', () => {
    const active = activeItemKey(sections, platformHref(ORG, 'providers/twilio'));
    expect(active).toBe('platform-providers');
    expect(itemContains(sections[0].items[0], active)).toBe(true);
  });
  it('only the already authorized canonical route container selects system identity', () => {
    expect(selectShellContext(ORG, platformHref(ORG, 'providers'), { organizationId: ORG })).toBe('platform');
    expect(selectShellContext(ORG, platformHref(ORG, 'providers'), null)).toBe('business');
    expect(selectShellContext('tenant', '/organizations/tenant/platform', { organizationId: ORG })).toBe('business');
    expect(selectShellContext(ORG, '/organizations/22222222-2222-4222-8222-222222222222/platform', { organizationId: ORG })).toBe('business');
    expect(selectShellContext(ORG, `/organizations/${ORG}/home`, { organizationId: ORG })).toBe('business');
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
    expect(platformHref(gold)).toBe(`/organizations/${gold}/platform`);
    expect(platformHref(gold, 'catalog/plans')).toBe(`/organizations/${gold}/platform/catalog/plans`);
    expect(inPlatformScope(platformHref(gold, 'billing'))).toBe(true);
    expect(inPlatformScope('/platform/billing')).toBe(false);
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
    const context = workspaceNavigation(project(), `/organizations/${ORG}/${workspace.home}`)!;
    expect(context.workspace.key).toBe(`workspace-${workspace.key}`);
    expect(context.backHref).toBe(`/organizations/${ORG}/home`);
    expect(context.sections[0].label).toBe(workspace.label);
    expect(context.sections[0].items[0]).toMatchObject({ label: 'Overview', href: `/organizations/${ORG}/${workspace.home}`, exact: true });
    expect(activeItemKey(context.sections, `/organizations/${ORG}/${workspace.home}`)).toBe('workspace-overview');
    const expected = AREAS.filter((area) => area.workspace === workspace.key && area.sidebar !== false && area.segment !== workspace.home);
    expect(context.sections[0].items.slice(1).filter(item => item.key !== 'workspace-configuration').map((item) => item.key)).toEqual(expected.map((area) => area.segment));
  });
  it.each([
    ['customers/123', 'crm', 'customers'], ['customers/pipeline', 'crm', 'pipeline'],
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
    const context = workspaceNavigation(project(), `/organizations/${ORG}/opportunities/123`)!;
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
    expect(workspaceNavigation(reduced, `/organizations/${ORG}/field`)!.sections[0].items.map((item) => item.key)).toEqual(['workspace-overview', 'work']);
  });
  it('does not carry workspace selection into another organization or organization Home', () => {
    expect(workspaceNavigation(project(), '/organizations/other/customers/123')).toBeNull();
    const switched = project(ALL_CAPABILITIES, { organizationId: '22222222-2222-4222-8222-222222222222' });
    expect(workspaceNavigation(switched, '/organizations/22222222-2222-4222-8222-222222222222/customers/123')!.backHref).toBe('/organizations/22222222-2222-4222-8222-222222222222/home');
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
    expect(location.groups[0].items[0].href).toBe(`${base}/field`);
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
  it('a single-destination workspace has only its real overview', () => {
    expect(pageNavigation(navigation, `${base}/marketing`, []).groups.flatMap((group) => group.items)).toHaveLength(1);
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
  it('adapts Platform grouping without exposing tenant workspaces', () => {
    const platformNavigation = { organizationId: ORG, sections: projectPlatformShell(ORG, new Set(['platform.providers'])) };
    const location = pageNavigation(platformNavigation, platformHref(ORG, 'providers/twilio'), []);
    expect(location.parentHref).toBe(platformHref(ORG, 'providers'));
    expect(location.groups.flatMap((group) => group.items).every((item) => item.href.startsWith(platformHref(ORG)))).toBe(true);
    expect(location.groups.flatMap((group) => group.items).some((item) => item.key === 'workspace-field')).toBe(false);
  });
});


describe('workspace Configuration authority', () => {
  it('lets a configuration-only member enter without Overview, Calls or Inbox', () => {
    const sections = project(['field.manage']);
    const row = projectedItems(sections).find(item => item.key === 'workspace-communications')!;
    expect(row.href).toBe(`/organizations/${ORG}/comms/configuration`);
    expect(row.configurationOnly).toBe(true);
    const context = workspaceNavigation(sections, row.href)!;
    expect(context.sections[0].items.map(item => item.key)).toEqual(['workspace-configuration']);
    expect(workspaceNavigation(sections, `/organizations/${ORG}/calls`)).toBeNull();
    expect(workspaceNavigation(sections, `/organizations/${ORG}/comms/inbox`)).toBeNull();
    expect(activeItemKey(context.sections, `/organizations/${ORG}/comms/configuration/calling`)).toBe('workspace-configuration');
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
    for (const suffix of ['comms/configuration', 'comms/configuration/calling', 'comms/configuration/email']) {
      const path = `/organizations/${ORG}/${suffix}`;
      const context = workspaceNavigation(project(), path)!;
      expect(context.workspace.key).toBe('workspace-communications');
      expect(activeItemKey(context.sections, path)).toBe('workspace-configuration');
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
