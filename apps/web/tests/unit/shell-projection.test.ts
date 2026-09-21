import { describe, expect, it } from 'vitest';
import { AREAS } from '@/lib/navigation';
import {
  activeItemKey,
  inPlatformScope,
  itemContains,
  projectedItems,
  projectPhone,
  projectShell,
  type ShellInput,
  type ShellSection,
} from '@/lib/shell';
import { PLATFORM_CAPABILITIES, type PlatformCapability } from '@/lib/domain/platform/permissions';
import {
  PLATFORM_DESTINATIONS,
  platformDestinationsFor,
  platformHref,
  platformRouteRequires,
} from '@/lib/platform-navigation';
import { ALL_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';
import { ROLE_PRESETS } from '@/lib/domain/tenancy/role-presets';

/**
 * The matrix. One projection resolves entitlement, permission, organization identity and platform
 * authority into the sections every renderer draws; these are the combinations that matter, proven
 * on the pure function so no breakpoint, role name or single owner account stands in for them.
 */

const ORG = 'org-1';

const EVERYTHING_MODULES = ['billing', 'assets', 'automations', 'reporting', 'reception', 'integrations', 'card_payments'];
const everyFeature = () => new Set(AREAS.flatMap((area) => area.featureKeys ?? []));

function project(
  capabilities: readonly Capability[],
  overrides: Partial<Pick<ShellInput, 'enabledModules' | 'featureAvailability' | 'platform'>> = {},
): ShellSection[] {
  return projectShell({
    organizationId: ORG,
    enabledModules: overrides.enabledModules ?? new Set(EVERYTHING_MODULES),
    featureAvailability: overrides.featureAvailability ?? everyFeature(),
    capabilities: new Set(capabilities),
    platform: overrides.platform ?? null,
  });
}

/** Every item in a section, a workspace followed by its pages — the order the sidebar draws them. */
const keys = (sections: ShellSection[], section?: string) =>
  projectedItems(section ? sections.filter((entry) => entry.key === section) : sections).map((item) => item.key);

/** Only what is drawn at the top level, so a nested page cannot pass for a workspace. */
const topLevel = (sections: ShellSection[], section: string) =>
  sections.filter((entry) => entry.key === section).flatMap((entry) => entry.items.map((item) => item.key));

const preset = (key: string) => ROLE_PRESETS.find((candidate) => candidate.key === key)!.capabilities;
const allPlatform = new Set<PlatformCapability>(PLATFORM_CAPABILITIES);

describe('GOLD owner who is also a platform operator', () => {
  const sections = project(ALL_CAPABILITIES, { platform: allPlatform });

  it('sees the business workspaces GOLD is entitled to', () => {
    expect(keys(sections, 'home')).toEqual(['home']);
    expect(topLevel(sections, 'workspaces')).toEqual(['customers', 'operations', 'calls', 'automations', 'insights']);
    // Work, Schedule, Resources, Locations and Assets are pages of Operations, not peers of Customers.
    expect(keys(sections, 'workspaces')).toEqual([
      'customers', 'operations', 'work', 'schedule', 'resources', 'locations', 'assets', 'calls', 'automations', 'insights',
    ]);
    expect(sections.flatMap((section) => section.items).find((item) => item.key === 'operations')?.children?.map((page) => page.key)).toEqual([
      'work', 'schedule', 'resources', 'locations', 'assets',
    ]);
  });

  it('sees organization administration, item by item', () => {
    expect(keys(sections, 'administration')).toEqual(['team', 'connections', 'plan', 'settings']);
  });

  it('sees every authorized Platform destination, and only through the projection', () => {
    const destinations = keys(sections, 'platform').filter((key) => !key.startsWith('platform-group-'));
    expect(destinations).toEqual(PLATFORM_DESTINATIONS.map((destination) => `platform-${destination.key}`).sort((a, b) => destinations.indexOf(a) - destinations.indexOf(b)));
    expect(destinations.sort()).toEqual(PLATFORM_DESTINATIONS.map((destination) => `platform-${destination.key}`).sort());
  });

  it('nests Platform as Catalog, Commercial and Infrastructure, beneath the same GOLD workspaces', () => {
    expect(topLevel(sections, 'platform')).toEqual([
      'platform-overview',
      'platform-organizations',
      'platform-catalog',
      'platform-group-commercial',
      'platform-group-infrastructure',
    ]);
    expect(keys(sections, 'platform')).toEqual([
      'platform-overview',
      'platform-organizations',
      'platform-catalog',
      'platform-plans',
      'platform-meters',
      'platform-connectors',
      'platform-group-commercial',
      'platform-pricing',
      'platform-billing',
      'platform-group-infrastructure',
      'platform-providers',
      'platform-failures',
    ]);
    // Platform is an added section: GOLD's own workspaces are all still there.
    expect(keys(sections, 'workspaces')).toContain('customers');
  });

  it('draws sections in one fixed order: Home, Workspaces, Platform, Administration', () => {
    expect(sections.map((section) => section.key)).toEqual(['home', 'workspaces', 'platform', 'administration']);
  });
});

describe('GOLD sales member in the same organization', () => {
  const sections = project(preset('sales'), { platform: null });

  it('uses GOLD as an ordinary business: sales, customers and calls', () => {
    expect(keys(sections, 'workspaces')).toEqual([
      'customers', 'operations', 'work', 'schedule', 'resources', 'locations', 'assets', 'calls', 'insights',
    ]);
  });

  it('sees no Platform and no administration they hold no authority for', () => {
    expect(keys(sections, 'platform')).toEqual([]);
    expect(keys(sections, 'administration')).toEqual([]);
    expect(sections.map((section) => section.key)).not.toContain('platform');
    expect(sections.map((section) => section.key)).not.toContain('administration');
  });

  it('does not see automation, which needs its own permission', () => {
    expect(keys(sections)).not.toContain('automations');
  });

  it('is not given platform items by being a member: platform authority is an input, not an inference', () => {
    // Everything an ordinary member holds, entitled to everything, and still no Platform.
    expect(keys(project(ALL_CAPABILITIES, { platform: null }), 'platform')).toEqual([]);
  });
});

describe('a platform member with limited platform permissions', () => {
  it('sees only the destinations their permissions reach', () => {
    const providersOnly = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.providers']) });
    expect(keys(providersOnly, 'platform')).toEqual(['platform-group-infrastructure', 'platform-providers']);

    const commercial = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.commercial']) });
    expect(keys(commercial, 'platform')).toEqual(['platform-group-commercial', 'platform-pricing', 'platform-billing']);

    const catalogue = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.catalogue']) });
    expect(keys(catalogue, 'platform')).toEqual(['platform-catalog', 'platform-plans', 'platform-meters', 'platform-connectors']);
  });

  it('does not gain full platform administration, nor organization administration, from one permission', () => {
    const limited = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.organizations']) });
    expect(keys(limited, 'platform')).toEqual(['platform-organizations']);
    expect(keys(limited, 'administration')).toEqual([]);
  });

  it('a person who holds no platform permission has an empty set, and so no Platform section', () => {
    expect(project(preset('support'), { platform: new Set() }).map((section) => section.key)).not.toContain('platform');
  });
});

describe('tenant owner or administrator', () => {
  const sections = project(ALL_CAPABILITIES, { platform: null });

  it('sees the tenant workspaces and the administration they hold authority for', () => {
    expect(keys(sections, 'workspaces')).toContain('customers');
    expect(keys(sections, 'administration')).toEqual(['team', 'connections', 'plan', 'settings']);
  });

  it('never sees GOLD Platform controls, however many capabilities they hold', () => {
    expect(keys(sections, 'platform')).toEqual([]);
    expect(projectedItems(sections).some((item) => item.href.includes('/platform'))).toBe(false);
  });

  it('a preset administrator holds the same reach as the founding role', () => {
    expect(keys(project(preset('administrator')))).toEqual(keys(sections));
  });
});

describe('tenant ordinary member', () => {
  const technician = project(preset('technician'));

  it('sees the operational workspaces their business has, and nothing administrative', () => {
    expect(keys(technician, 'workspaces')).toEqual(['customers', 'operations', 'work', 'schedule', 'resources', 'locations', 'assets']);
    expect(keys(technician, 'administration')).toEqual([]);
    expect(keys(technician, 'platform')).toEqual([]);
  });

  it('a viewer with no capability at all still gets the kernel, and no administration', () => {
    const viewer = project(preset('viewer'));
    expect(keys(viewer, 'home')).toEqual(['home']);
    expect(keys(viewer, 'workspaces')).toEqual(['customers', 'operations', 'work', 'schedule', 'resources', 'locations', 'assets']);
    expect(keys(viewer, 'administration')).toEqual([]);
  });
});

describe('configuration-only authority', () => {
  it('reaches Settings for what they may configure even when they cannot operate the workspace', () => {
    const configurer = project(['field.manage']);
    // Cannot place calls, so there is no calling workspace for them…
    expect(keys(configurer, 'workspaces')).not.toContain('calls');
    // …yet the configuration index is theirs, because they may configure.
    expect(keys(configurer, 'administration')).toEqual(['settings']);
  });

  it('is offered exactly the administration items their own permissions name', () => {
    expect(keys(project(['role.manage']), 'administration')).toEqual(['team', 'settings']);
    expect(keys(project(['billing.manage']), 'administration')).toEqual(['plan', 'settings']);
    expect(keys(project(['integration.manage']), 'administration')).toEqual(['connections', 'settings']);
  });
});

describe('entitlement absent', () => {
  it('a broad role does not conjure a workspace the business does not have', () => {
    const sections = project(ALL_CAPABILITIES, { enabledModules: new Set(), featureAvailability: new Set() });
    // Assets is a module: without it Operations has the rest of its pages, and no more.
    expect(keys(sections, 'workspaces')).toEqual(['customers', 'operations', 'work', 'schedule', 'resources', 'locations']);
    // Connections is a product too: no Integrations entitlement, no item — Team and Plan remain.
    expect(keys(sections, 'administration')).toEqual(['team', 'plan', 'settings']);
  });

  it('the kernel — Home, Customers, Work, Schedule, Setup — never depends on a module', () => {
    for (const segment of ['home', 'customers', 'work', 'schedule', 'setup']) {
      const area = AREAS.find((candidate) => candidate.segment === segment)!;
      expect(area.module, segment).toBeUndefined();
    }
  });
});

describe('the phone renders the same projection', () => {
  const sections = project(ALL_CAPABILITIES, { platform: allPlatform });
  const { primary, more } = projectPhone(sections);
  /** A heading is a disclosure with no page of its own; the phone lists the pages beneath it. */
  const pagesOf = (items: { key: string; heading?: boolean }[]) => items.filter((item) => !item.heading).map((item) => item.key).sort();

  it('in a business carries Home and the first workspace pages in the bar, and everything else behind More', () => {
    // A workspace with pages contributes its pages, so Work and Schedule stay one tap away.
    expect(primary.map((item) => item.key)).toEqual(['home', 'customers', 'work', 'schedule']);
    expect(more.map((section) => section.label)).toEqual([
      'Workspaces', 'Operations', 'Platform', 'Catalog', 'Commercial', 'Infrastructure', 'Administration',
    ]);
    expect(more[0].items.map((item) => item.key)).toEqual(['calls', 'automations', 'insights']);
    expect(more[1].items.map((item) => item.key)).toEqual(['operations', 'resources', 'locations', 'assets']);
    expect(more[1].items[0].label).toBe('Overview');
  });

  it('loses and adds nothing: the bar and More together are exactly the desktop projection', () => {
    const phone = pagesOf([...primary, ...more.flatMap((section) => section.items)]);
    expect(phone).toEqual(pagesOf(projectedItems(sections)));
  });

  it('inside Platform presents Platform: a way back to Home, the Platform destinations, and the rest behind More', () => {
    const platform = projectPhone(sections, { platformActive: true });
    expect(platform.primary.map((item) => item.key)).toEqual([
      'home',
      'platform-overview',
      'platform-organizations',
      'platform-catalog',
      'platform-group-commercial',
      'platform-group-infrastructure',
    ]);
    // Platform's own pages lead More; GOLD's workspaces follow. Ten Platform destinations and every workspace never share the bar.
    expect(platform.more.map((section) => section.label)).toEqual([
      'Catalog', 'Commercial', 'Infrastructure', 'Workspaces', 'Operations', 'Administration',
    ]);
    const phone = pagesOf([...platform.primary, ...platform.more.flatMap((section) => section.items)]);
    expect(phone).toEqual(pagesOf(projectedItems(sections)));
  });

  it('is the ordinary business bar when the person is not in Platform, even with Platform authority', () => {
    expect(projectPhone(sections, { platformActive: false }).primary.map((item) => item.key)).toEqual(primary.map((item) => item.key));
  });

  it('falls back to the business bar when there is no Platform to present', () => {
    const noPlatform = project(ALL_CAPABILITIES, { platform: null });
    expect(projectPhone(noPlatform, { platformActive: true }).primary.map((item) => item.key)).toEqual(['home', 'customers', 'work', 'schedule']);
  });

  it('never puts Administration or Platform in the bar, however few workspaces there are', () => {
    const tiny = projectPhone(project([], { enabledModules: new Set(), featureAvailability: new Set(), platform: allPlatform }));
    expect(tiny.primary.every((item) => item.section === 'home' || item.section === 'workspaces')).toBe(true);
  });

  it('leaves only the rest of Operations behind More for somebody with the kernel and nothing else', () => {
    const minimal = projectShell({
      organizationId: ORG,
      enabledModules: new Set(),
      featureAvailability: new Set(),
      capabilities: new Set(),
      platform: null,
    }).filter((section) => section.key === 'home' || section.key === 'workspaces');
    const { more: rest } = projectPhone(minimal);
    expect(rest.map((section) => [section.label, section.items.map((item) => item.key)])).toEqual([
      ['Operations', ['operations', 'resources', 'locations']],
    ]);
  });
});

describe('the current item', () => {
  const sections = project(ALL_CAPABILITIES, { platform: allPlatform });

  it('marks the most specific item, never two', () => {
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/plan`)).toBe('plan');
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/general`)).toBe('settings');
    expect(activeItemKey(sections, `/organizations/${ORG}/work/abc`)).toBe('work');
    expect(activeItemKey(sections, `/organizations/${ORG}/roles`)).toBe('team');
    expect(activeItemKey(sections, platformHref(ORG, 'catalog/plans/base'))).toBe('platform-plans');
    expect(activeItemKey(sections, platformHref(ORG, 'catalog'))).toBe('platform-catalog');
    expect(activeItemKey(sections, platformHref(ORG))).toBe('platform-overview');
    expect(activeItemKey(sections, platformHref(ORG, 'organizations/x/usage'))).toBe('platform-organizations');
  });

  it('a page of a workspace activates itself and opens its workspace, and the workspace overview only itself', () => {
    const items = sections.flatMap((section) => section.items);
    const operations = items.find((item) => item.key === 'operations')!;
    for (const page of ['work', 'schedule', 'resources', 'locations', 'assets']) {
      const active = activeItemKey(sections, `/organizations/${ORG}/${page}`);
      expect(active).toBe(page);
      expect(itemContains(operations, active)).toBe(true);
    }
    expect(activeItemKey(sections, `/organizations/${ORG}/operations`)).toBe('operations');
    expect(itemContains(items.find((item) => item.key === 'customers')!, 'work')).toBe(false);
  });

  it('inside Platform the group holding the current page is the one that is open, and a heading yields to its first page', () => {
    const platformItems = sections.find((section) => section.key === 'platform')!.items;
    const commercial = platformItems.find((item) => item.key === 'platform-group-commercial')!;
    const infrastructure = platformItems.find((item) => item.key === 'platform-group-infrastructure')!;
    const active = activeItemKey(sections, platformHref(ORG, 'pricing'));
    expect(active).toBe('platform-pricing');
    expect(itemContains(commercial, active)).toBe(true);
    expect(itemContains(infrastructure, active)).toBe(false);
    // The Overview is the root of the whole Platform tree and marks itself only, never a page beneath it.
    expect(activeItemKey(sections, platformHref(ORG, 'providers/twilio'))).toBe('platform-providers');
  });

  it('marks nothing on a Platform address when the person has no Platform in their projection', () => {
    expect(activeItemKey(project(ALL_CAPABILITIES, { platform: null }), platformHref(ORG, 'providers'))).toBeNull();
  });

  it('marks nothing for a page the person’s projection does not list', () => {
    expect(activeItemKey(project(preset('viewer')), `/organizations/${ORG}/settings/plan`)).toBeNull();
  });
});

describe('platform routes and their permission', () => {
  it('a path takes the permission of its longest registered prefix', () => {
    // Paths are read beneath the platform root: `platformHref(id, path)` is the only way to spell one.
    expect(platformRouteRequires('')).toBe('platform.health');
    expect(platformRouteRequires('failures')).toBe('platform.health');
    expect(platformRouteRequires('organizations')).toBe('platform.organizations');
    expect(platformRouteRequires('organizations/abc/providers')).toBe('platform.organizations');
    expect(platformRouteRequires('catalog/plans/base')).toBe('platform.catalogue');
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
