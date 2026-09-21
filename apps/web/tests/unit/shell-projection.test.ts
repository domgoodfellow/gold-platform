import { describe, expect, it } from 'vitest';
import { AREAS } from '@/lib/navigation';
import {
  activeItemKey,
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

const keys = (sections: ShellSection[], section?: string) =>
  (section ? sections.filter((entry) => entry.key === section) : sections).flatMap((entry) => entry.items.map((item) => item.key));

const preset = (key: string) => ROLE_PRESETS.find((candidate) => candidate.key === key)!.capabilities;
const allPlatform = new Set<PlatformCapability>(PLATFORM_CAPABILITIES);

describe('GOLD owner who is also a platform operator', () => {
  const sections = project(ALL_CAPABILITIES, { platform: allPlatform });

  it('sees the business workspaces GOLD is entitled to', () => {
    expect(keys(sections, 'home')).toEqual(['home']);
    expect(keys(sections, 'workspaces')).toEqual(['customers', 'work', 'schedule', 'calls', 'automations', 'insights']);
    expect(keys(sections, 'operations')).toEqual(['resources', 'locations', 'assets']);
  });

  it('sees organization administration, item by item', () => {
    expect(keys(sections, 'administration')).toEqual(['team', 'connections', 'plan', 'settings']);
  });

  it('sees every authorized Platform destination, and only through the projection', () => {
    expect(keys(sections, 'platform')).toEqual(PLATFORM_DESTINATIONS.map((destination) => `platform-${destination.key}`));
  });

  it('draws sections in one fixed order: Home, workspaces, Operations, Administration, Platform', () => {
    expect(sections.map((section) => section.key)).toEqual(['home', 'workspaces', 'operations', 'administration', 'platform']);
  });
});

describe('GOLD sales member in the same organization', () => {
  const sections = project(preset('sales'), { platform: null });

  it('uses GOLD as an ordinary business: sales, customers and calls', () => {
    expect(keys(sections, 'workspaces')).toEqual(['customers', 'work', 'schedule', 'calls', 'insights']);
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
    expect(keys(providersOnly, 'platform')).toEqual(['platform-providers']);

    const commercial = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.commercial']) });
    expect(keys(commercial, 'platform')).toEqual(['platform-pricing', 'platform-billing']);

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
    expect(projectedItems(sections).some((item) => item.href.startsWith('/platform'))).toBe(false);
  });

  it('a preset administrator holds the same reach as the founding role', () => {
    expect(keys(project(preset('administrator')))).toEqual(keys(sections));
  });
});

describe('tenant ordinary member', () => {
  const technician = project(preset('technician'));

  it('sees the operational workspaces their business has, and nothing administrative', () => {
    expect(keys(technician, 'workspaces')).toEqual(['customers', 'work', 'schedule']);
    expect(keys(technician, 'operations')).toEqual(['resources', 'locations', 'assets']);
    expect(keys(technician, 'administration')).toEqual([]);
    expect(keys(technician, 'platform')).toEqual([]);
  });

  it('a viewer with no capability at all still gets the kernel, and no administration', () => {
    const viewer = project(preset('viewer'));
    expect(keys(viewer, 'home')).toEqual(['home']);
    expect(keys(viewer, 'workspaces')).toEqual(['customers', 'work', 'schedule']);
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
    expect(keys(sections, 'workspaces')).toEqual(['customers', 'work', 'schedule']);
    expect(keys(sections, 'operations')).toEqual(['resources', 'locations']);
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

  it('carries Home and the first workspaces in the bar, and everything else behind More', () => {
    expect(primary.map((item) => item.key)).toEqual(['home', 'customers', 'work', 'schedule']);
    expect(more.map((section) => section.key)).toEqual(['workspaces', 'operations', 'administration', 'platform']);
  });

  it('loses and adds nothing: the bar and More together are exactly the desktop projection', () => {
    const phone = [...primary, ...more.flatMap((section) => section.items)].map((item) => item.key).sort();
    expect(phone).toEqual(projectedItems(sections).map((item) => item.key).sort());
  });

  it('never puts Administration or Platform in the bar, however few workspaces there are', () => {
    const tiny = projectPhone(project([], { enabledModules: new Set(), featureAvailability: new Set(), platform: allPlatform }));
    expect(tiny.primary.every((item) => item.section === 'home' || item.section === 'workspaces')).toBe(true);
  });

  it('has no More at all for somebody with nothing beyond the bar', () => {
    const minimal = projectShell({
      organizationId: ORG,
      enabledModules: new Set(),
      featureAvailability: new Set(),
      capabilities: new Set(),
      platform: null,
    }).filter((section) => section.key === 'home' || section.key === 'workspaces');
    // Three workspaces and Home fit the bar exactly.
    expect(projectPhone(minimal).more).toEqual([]);
  });
});

describe('the current item', () => {
  const sections = project(ALL_CAPABILITIES, { platform: allPlatform });

  it('marks the most specific item, never two', () => {
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/plan`)).toBe('plan');
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/general`)).toBe('settings');
    expect(activeItemKey(sections, `/organizations/${ORG}/work/abc`)).toBe('work');
    expect(activeItemKey(sections, `/organizations/${ORG}/roles`)).toBe('team');
    expect(activeItemKey(sections, '/platform/catalog/plans/base')).toBe('platform-plans');
    expect(activeItemKey(sections, '/platform/catalog')).toBe('platform-catalog');
    expect(activeItemKey(sections, '/platform')).toBe('platform-overview');
    expect(activeItemKey(sections, '/platform/organizations/x/usage')).toBe('platform-organizations');
  });

  it('marks nothing for a page the person’s projection does not list', () => {
    expect(activeItemKey(project(preset('viewer')), `/organizations/${ORG}/settings/plan`)).toBeNull();
  });
});

describe('platform routes and their permission', () => {
  it('a path takes the permission of its longest registered prefix', () => {
    expect(platformRouteRequires('/platform')).toBe('platform.health');
    expect(platformRouteRequires('/platform/failures')).toBe('platform.health');
    expect(platformRouteRequires('/platform/organizations')).toBe('platform.organizations');
    expect(platformRouteRequires('/platform/organizations/abc/providers')).toBe('platform.organizations');
    expect(platformRouteRequires('/platform/catalog/plans/base')).toBe('platform.catalogue');
    expect(platformRouteRequires('/platform/integrations/new')).toBe('platform.catalogue');
    expect(platformRouteRequires('/platform/pricing')).toBe('platform.commercial');
    expect(platformRouteRequires('/platform/billing')).toBe('platform.commercial');
    expect(platformRouteRequires('/platform/providers/twilio/configure')).toBe('platform.providers');
  });

  it('refuses a path nobody classified, rather than serving it', () => {
    expect(platformRouteRequires('/platform/something-new')).toBe('platform.health');
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
