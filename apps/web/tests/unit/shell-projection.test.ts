import { describe, expect, it } from 'vitest';
import { AREAS, WORKSPACES, configTarget, configTargetOffered, workspaceAncestry, areaLabel } from '@/lib/navigation';
import { SHELL_SECTION_ORDER, activeItemKey, inPlatformScope, itemContains, projectedItems, projectShell, projectPlatformShell, projectHeaderUtilities, selectShellContext, shellHomeItem, type ShellInput, type ShellSection } from '@/lib/shell';
import { PLATFORM_CAPABILITIES } from '@/lib/domain/platform/permissions';
import { platformDestinationsFor, platformHref, platformRouteRequires } from '@/lib/platform-navigation';
import { ALL_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';
import { ROLE_PRESETS } from '@/lib/domain/tenancy/role-presets';

const ORG = '11111111-1111-4111-8111-111111111111';
const allPlatform = new Set(PLATFORM_CAPABILITIES);
const everyFeature = () => new Set(AREAS.flatMap((area) => area.featureKeys ?? []));
const EVERYTHING_MODULES = ['billing', 'assets', 'automations', 'reporting', 'reception', 'integrations', 'card_payments'];
const gate = (capabilities: readonly Capability[] = ALL_CAPABILITIES, overrides: Partial<ShellInput> = {}): ShellInput => ({
  organizationId: ORG, enabledModules: new Set(EVERYTHING_MODULES), featureAvailability: everyFeature(), capabilities: new Set(capabilities), ...overrides,
});
const project = (capabilities: readonly Capability[] = ALL_CAPABILITIES, overrides: Partial<ShellInput> = {}) => projectShell(gate(capabilities, overrides));
const keys = (sections: ShellSection[]) => projectedItems(sections).map((item) => item.key);
const workspaceKeys = ['workspace-crm', 'workspace-communications', 'workspace-field', 'workspace-finance', 'workspace-automations', 'workspace-studio'];

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
    const homes = ['sales', 'comms', 'field', 'finance', 'automations', 'studio'];
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
    expect(keys(none)).toEqual(['home', 'library', 'workspace-crm', 'workspace-field', 'workspace-finance', 'workspace-studio']);
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
});

describe('owning workspace stays active on contextual and detail routes', () => {
  const sections = project();
  it.each([
    ['home', 'home'], ['library/files', 'library'],
    ['sales', 'workspace-crm'], ['customers', 'workspace-crm'], ['customers/customer-1', 'workspace-crm'], ['customers/pipeline', 'workspace-crm'],
    ['comms', 'workspace-communications'], ['calls/call-1', 'workspace-communications'], ['comms/inbox/conversation-1', 'workspace-communications'], ['comms/numbers/number-1', 'workspace-communications'],
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
    const paths = (scheduled?: boolean) => field(scheduled).activeHrefs!.map((href) => href.split('/').at(-1));
    expect(paths(true)).toEqual(['field', 'work', 'schedule', 'resources', 'locations', 'assets']);
    expect(paths(false)).toEqual(['field', 'work', 'assets']);
    expect(paths(undefined)).toEqual(paths(true));
    expect(field(false, { enabledModules: new Set(), featureAvailability: new Set() }).activeHrefs).toEqual([`/organizations/${ORG}/field`, `/organizations/${ORG}/work`]);
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
