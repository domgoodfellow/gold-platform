import { describe, expect, it } from 'vitest';
import { AREAS, configTarget, configTargetOffered } from '@/lib/navigation';
import {
  ADMINISTRATION_SECTIONS,
  SHELL_SECTION_ORDER,
  activeItemKey,
  businessSettingsOffered,
  inPlatformScope,
  itemContains,
  projectedItems,
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
    // One row per registered workspace that has a reachable area, in the order a customer meets
    // them. Service and AI are registered and have no page, so they draw no row. Studio has one
    // page (Home), so it draws a plain row with no children. Finance also has one AREA page
    // (Home), but this platform operator's own `platform.commercial` permission adds a second,
    // GOLD-only child (Plans & Add-ons), so Finance is an expandable row for them though it would
    // be a plain row for an ordinary member. Insights is not a workspace row at all (D66) — it is
    // reached contextually.
    expect(topLevel(sections, 'workspaces')).toEqual(['workspace-crm', 'workspace-communications', 'workspace-finance', 'workspace-automations', 'workspace-field', 'workspace-studio']);
    expect(keys(sections, 'workspaces')).toEqual([
      'workspace-crm', 'customers', 'pipeline',
      'workspace-communications', 'calls', 'comms-inbox', 'comms-numbers',
      'workspace-finance', 'finance-plans',
      'workspace-automations', 'automation-rules', 'automation-messages', 'automation-activity',
      'workspace-field', 'work', 'schedule', 'resources', 'locations', 'assets',
      'workspace-studio',
    ]);
    const row = (key: string) => sections.flatMap((section) => section.items).find((item) => item.key === key)!;
    // The parent's own destination is the workspace's Home, never repeated as a child beneath it.
    expect(row('workspace-field').children?.map((page) => page.key)).toEqual(['work', 'schedule', 'resources', 'locations', 'assets']);
    expect(row('workspace-crm').children?.map((page) => page.key)).toEqual(['customers', 'pipeline']);
    expect(row('workspace-automations').children?.map((page) => page.label)).toEqual(['Rules', 'Messages', 'Activity']);
    expect(row('workspace-communications').children?.map((page) => page.key)).toEqual(['calls', 'comms-inbox', 'comms-numbers']);
    expect(row('workspace-field').label).toBe('Field');
    expect(row('workspace-field').href).toBe(`/organizations/${ORG}/field`);
    expect(row('workspace-crm').href).toBe(`/organizations/${ORG}/sales`);
    expect(row('workspace-communications').href).toBe(`/organizations/${ORG}/comms`);
    expect(row('workspace-automations').href).toBe(`/organizations/${ORG}/automations`);
    // For this platform operator, Finance is expandable: Home plus Plans & Add-ons.
    expect(row('workspace-finance').children?.map((page) => page.key)).toEqual(['finance-plans']);
    expect(row('workspace-finance').heading).toBe(true);
    expect(row('workspace-finance').href).toBe(`/organizations/${ORG}/finance`);
    expect(row('workspace-finance').children?.find((page) => page.key === 'finance-plans')?.href).toBe(`/organizations/${ORG}/finance/plans`);
    // Studio still has exactly one reachable area, so it stays a plain row: no children, no chevron.
    expect(row('workspace-studio').children).toBeUndefined();
    expect(row('workspace-studio').heading).toBeUndefined();
    expect(row('workspace-studio').href).toBe(`/organizations/${ORG}/studio`);
  });

  it('is a plain row without Plans & Add-ons for a member with no platform authority', () => {
    const noPlatform = project(ALL_CAPABILITIES, { platform: null });
    const row = noPlatform.flatMap((section) => section.items).find((item) => item.key === 'workspace-finance')!;
    expect(row.children).toBeUndefined();
    expect(row.heading).toBeUndefined();
    expect(keys(noPlatform, 'workspaces')).not.toContain('finance-plans');
  });

  it('sees organization administration, item by item', () => {
    expect(keys(sections, 'business')).toEqual(['team', 'connections', 'plan']);
  });

  it('sees every authorized Platform destination, and only through the projection', () => {
    // The root destination is the Platform row itself, never a `platform-overview` child.
    const destinations = keys(sections, 'platform').filter((key) => !key.startsWith('platform-group-'));
    const expected = PLATFORM_DESTINATIONS.map((destination) => (destination.path === '' ? 'platform' : `platform-${destination.key}`));
    expect(destinations.sort()).toEqual(expected.sort());
  });

  it('nests Platform as one row, holding Organizations and Catalog, Commercial and Infrastructure', () => {
    // Platform is a single workspace-style parent at the top level — its own Home, never a repeated child.
    expect(topLevel(sections, 'platform')).toEqual(['platform']);
    expect(keys(sections, 'platform')).toEqual([
      'platform',
      'platform-organizations',
      'platform-group-catalog',
      'platform-products',
      'platform-meters',
      'platform-connectors',
      'platform-group-commercial',
      'platform-pricing',
      'platform-usage-economics',
      'platform-vendor-rates',
      'platform-package-economics',
      'platform-billing',
      'platform-group-infrastructure',
      'platform-providers',
      'platform-ai-runtime',
      'platform-failures',
    ]);
    const platform = sections.flatMap((section) => section.items).find((item) => item.key === 'platform')!;
    expect(platform.label).toBe('Platform');
    expect(platform.href).toBe(platformHref(ORG, ''));
    expect(platform.heading).toBe(true);
    // Platform is an added section: GOLD's own workspaces are all still there.
    expect(keys(sections, 'workspaces')).toContain('customers');
  });

  it('labels its sections Home, Library, Workspaces, Business, Platform administration', () => {
    expect(sections.map((section) => section.label)).toEqual([null, null, 'Workspaces', 'Business', 'Platform administration']);
  });

  it('names the tenant destination Connections and the platform one Connectors, once each', () => {
    const items = projectedItems(sections);
    const label = (key: string) => items.find((item) => item.key === key)?.label;
    expect(label('connections')).toBe('Connections');
    expect(label('platform-connectors')).toBe('Connectors');
    const labels = items.map((item) => item.label);
    expect(labels.filter((name) => name === 'Connections')).toHaveLength(1);
    expect(labels.filter((name) => name === 'Connectors')).toHaveLength(1);
    expect(labels).not.toContain('Integrations');
  });

  it('draws sections in one fixed order: Home, Library, Workspaces, Business, Platform', () => {
    expect(sections.map((section) => section.key)).toEqual(['home', 'library', 'workspaces', 'business', 'platform']);
  });
});

describe('GOLD sales member in the same organization', () => {
  const sections = project(preset('sales'), { platform: null });

  it('uses GOLD as an ordinary business: sales, customers and calls', () => {
    expect(keys(sections, 'workspaces')).toEqual([
      'workspace-crm', 'customers', 'pipeline', 'workspace-communications', 'calls', 'comms-inbox', 'comms-numbers', 'workspace-finance', 'workspace-field', 'work', 'schedule', 'resources', 'locations', 'assets', 'workspace-studio',
    ]);
  });

  it('sees no Platform and no administration they hold no authority for', () => {
    expect(keys(sections, 'platform')).toEqual([]);
    expect(keys(sections, 'business')).toEqual([]);
    expect(sections.map((section) => section.key)).not.toContain('platform');
    expect(sections.map((section) => section.key)).not.toContain('business');
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
    expect(keys(providersOnly, 'platform')).toEqual(['platform', 'platform-group-infrastructure', 'platform-providers', 'platform-ai-runtime']);

    const commercial = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.commercial']) });
    expect(keys(commercial, 'platform')).toEqual(['platform', 'platform-group-commercial', 'platform-pricing', 'platform-usage-economics', 'platform-vendor-rates', 'platform-package-economics', 'platform-billing']);

    const catalogue = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.catalogue']) });
    expect(keys(catalogue, 'platform')).toEqual(['platform', 'platform-group-catalog', 'platform-products', 'platform-meters', 'platform-connectors']);
  });

  it('does not gain full platform administration, nor organization administration, from one permission', () => {
    const limited = project(preset('support'), { platform: new Set<PlatformCapability>(['platform.organizations']) });
    expect(keys(limited, 'platform')).toEqual(['platform', 'platform-organizations']);
    expect(keys(limited, 'business')).toEqual([]);
  });

  it('a person who holds no platform permission has an empty set, and so no Platform section', () => {
    expect(project(preset('support'), { platform: new Set() }).map((section) => section.key)).not.toContain('platform');
  });
});

describe('tenant owner or administrator', () => {
  const sections = project(ALL_CAPABILITIES, { platform: null });

  it('sees the tenant workspaces and the administration they hold authority for', () => {
    expect(keys(sections, 'workspaces')).toContain('customers');
    expect(keys(sections, 'business')).toEqual(['team', 'connections', 'plan']);
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
    expect(keys(technician, 'workspaces')).toEqual(['workspace-crm', 'customers', 'pipeline', 'workspace-finance', 'workspace-field', 'work', 'schedule', 'resources', 'locations', 'assets', 'workspace-studio']);
    expect(keys(technician, 'business')).toEqual([]);
    expect(keys(technician, 'platform')).toEqual([]);
  });

  it('a viewer with no capability at all still gets the kernel, and no administration', () => {
    const viewer = project(preset('viewer'));
    expect(keys(viewer, 'home')).toEqual(['home']);
    expect(keys(viewer, 'workspaces')).toEqual(['workspace-crm', 'customers', 'pipeline', 'workspace-finance', 'workspace-field', 'work', 'schedule', 'resources', 'locations', 'assets', 'workspace-studio']);
    expect(keys(viewer, 'business')).toEqual([]);
  });
});

describe('configuration-only authority', () => {
  it('has nothing in Business administration, but Business settings still offers them a target — no permanent sidebar row either way', () => {
    const configurer = project(['field.manage']);
    // Cannot place calls, so there is no calling workspace for them…
    expect(keys(configurer, 'workspaces')).not.toContain('calls');
    // …none of Team, Connections or Plan & usage names their capability, so Business
    // administration has nothing to show — Settings is not a fourth permanent row beside them.
    expect(keys(configurer, 'business')).toEqual([]);
    // Yet the account menu's Business settings link is theirs, because they may configure.
    expect(businessSettingsOffered({ enabledModules: new Set(EVERYTHING_MODULES), featureAvailability: everyFeature(), capabilities: new Set(['field.manage']) })).toBe(true);
  });

  it('is offered exactly the administration items their own permissions name', () => {
    expect(keys(project(['role.manage']), 'business')).toEqual(['team']);
    expect(keys(project(['billing.manage']), 'business')).toEqual(['plan']);
    expect(keys(project(['integration.manage']), 'business')).toEqual(['connections']);
  });
});

describe('entitlement absent', () => {
  it('a broad role does not conjure a workspace the business does not have', () => {
    const sections = project(ALL_CAPABILITIES, { enabledModules: new Set(), featureAvailability: new Set() });
    // Assets is a module: without it Field has the rest of its pages, and no more. No modules: no
    // Pipeline, so Sales has just Home and the kernel Customers; the Home is never a child.
    expect(keys(sections, 'workspaces')).toEqual([
      'workspace-crm', 'customers', 'workspace-finance', 'workspace-field', 'work', 'schedule', 'resources', 'locations', 'workspace-studio',
    ]);
    // Connections is a product too: no Integrations entitlement, no item — Team and Plan remain.
    expect(keys(sections, 'business')).toEqual(['team', 'plan']);
  });

  it('the kernel — Home, Customers, Work, Schedule, Setup — never depends on a module', () => {
    for (const segment of ['home', 'customers', 'work', 'schedule', 'setup']) {
      const area = AREAS.find((candidate) => candidate.segment === segment)!;
      expect(area.module, segment).toBeUndefined();
    }
  });
});

describe('the current item', () => {
  const sections = project(ALL_CAPABILITIES, { platform: allPlatform });

  it('marks the most specific item, never two', () => {
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/plan`)).toBe('plan');
    // Settings is no longer a permanent sidebar row (Business settings is reached from the
    // account menu instead), so nothing in the sidebar highlights while visiting it.
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/general`)).toBeNull();
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/pricing`)).toBeNull();
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/custom-fields`)).toBeNull();
    expect(activeItemKey(sections, `/organizations/${ORG}/work/abc`)).toBe('work');
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/access/roles`)).toBe('team');
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/access/members`)).toBe('team');
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/access/invitations`)).toBe('team');
    expect(activeItemKey(sections, `/organizations/${ORG}/settings/connections/connection-1`)).toBe('connections');
    // Plans & Add-ons moved to Finance (D25's Catalogue/Plan split); the old address is a redirect
    // stub, no longer a registered destination, so the longest remaining match is Products.
    expect(activeItemKey(sections, platformHref(ORG, 'catalog/plans/base'))).toBe('platform-products');
    expect(activeItemKey(sections, `/organizations/${ORG}/finance/plans/base`)).toBe('finance-plans');
    expect(activeItemKey(sections, platformHref(ORG, 'catalog'))).toBe('platform-products');
    expect(activeItemKey(sections, platformHref(ORG, 'catalog/families/comms'))).toBe('platform-products');
    expect(activeItemKey(sections, platformHref(ORG))).toBe('platform');
    expect(activeItemKey(sections, platformHref(ORG, 'organizations/x/usage'))).toBe('platform-organizations');
  });

  it('a page of a workspace activates itself and opens its workspace, and the workspace overview only itself', () => {
    const items = sections.flatMap((section) => section.items);
    const field = items.find((item) => item.key === 'workspace-field')!;
    for (const page of ['work', 'schedule', 'resources', 'locations', 'assets']) {
      const active = activeItemKey(sections, `/organizations/${ORG}/${page}`);
      expect(active).toBe(page);
      expect(itemContains(field, active)).toBe(true);
    }
    // Home is never a child, so its own address marks the parent — not a separate 'field' leaf.
    expect(activeItemKey(sections, `/organizations/${ORG}/field`)).toBe('workspace-field');
    expect(itemContains(items.find((item) => item.key === 'workspace-crm')!, 'work')).toBe(false);
    // A page of a bigger route activates itself, not the page it is nested under.
    expect(activeItemKey(sections, `/organizations/${ORG}/customers/pipeline`)).toBe('pipeline');
    expect(activeItemKey(sections, `/organizations/${ORG}/customers/abc`)).toBe('customers');
    expect(activeItemKey(sections, `/organizations/${ORG}/automations/messages`)).toBe('automation-messages');
    // A rule's own detail route is nested under Automations Home's address, not Rules' — it
    // activates the parent, the same rule the Home/child split follows everywhere else.
    expect(activeItemKey(sections, `/organizations/${ORG}/automations/rule-1`)).toBe('workspace-automations');
    expect(activeItemKey(sections, `/organizations/${ORG}/automations/rules`)).toBe('automation-rules');
    // Studio is a plain row: its own address marks the row itself, the same as any other Home.
    expect(activeItemKey(sections, `/organizations/${ORG}/studio`)).toBe('workspace-studio');
  });

  it('inside Platform the group holding the current page is the one that is open, and a heading yields to its first page', () => {
    const platformRoot = sections.find((section) => section.key === 'platform')!.items[0];
    const commercial = platformRoot.children!.find((item) => item.key === 'platform-group-commercial')!;
    const infrastructure = platformRoot.children!.find((item) => item.key === 'platform-group-infrastructure')!;
    const active = activeItemKey(sections, platformHref(ORG, 'pricing'));
    expect(active).toBe('platform-pricing');
    expect(itemContains(commercial, active)).toBe(true);
    expect(itemContains(infrastructure, active)).toBe(false);
    // Platform itself is the root of the whole tree and contains everything beneath it.
    expect(itemContains(platformRoot, active)).toBe(true);
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
    // Plans & Add-ons moved to Finance and is no longer a registered destination; the old address
    // still resolves (Products is the next-longest registered prefix under `catalog`).
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

describe('the permission gradient: operating work, then business administration, then platform', () => {
  const partial = new Set<PlatformCapability>(['platform.catalogue']);
  const personas: { name: string; sections: ShellSection[]; sectionKeys: string[]; platformTop: string[] }[] = [
    { name: 'ordinary tenant member', sections: project(preset('technician')), sectionKeys: ['home', 'library', 'workspaces'], platformTop: [] },
    { name: 'tenant administrator', sections: project(ALL_CAPABILITIES), sectionKeys: ['home', 'library', 'workspaces', 'business'], platformTop: [] },
    // Same organization as the platform operator below, but no platform_staff permission: an ordinary business.
    { name: 'GOLD member without platform permission', sections: project(preset('sales'), { platform: new Set() }), sectionKeys: ['home', 'library', 'workspaces'], platformTop: [] },
    {
      name: 'platform staff with partial permissions',
      sections: project(ALL_CAPABILITIES, { platform: partial }),
      sectionKeys: ['home', 'library', 'workspaces', 'business', 'platform'],
      platformTop: ['platform'],
    },
    {
      name: 'platform owner',
      sections: project(ALL_CAPABILITIES, { platform: allPlatform }),
      sectionKeys: ['home', 'library', 'workspaces', 'business', 'platform'],
      platformTop: ['platform'],
    },
  ];

  for (const persona of personas) {
    it(`${persona.name}: sees exactly their tiers, in scope order`, () => {
      expect(persona.sections.map((section) => section.key)).toEqual(persona.sectionKeys);
      // Relative hierarchy: whatever is present follows the one fixed order.
      const positions = persona.sections.map((section) => SHELL_SECTION_ORDER.indexOf(section.key));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(topLevel(persona.sections, 'platform')).toEqual(persona.platformTop);
    });

    it(`${persona.name}: every administration item comes after every operating item`, () => {
      const all = projectedItems(persona.sections);
      const lastOperating = Math.max(-1, ...all.map((item, index) => (ADMINISTRATION_SECTIONS.has(item.section) ? -1 : index)));
      const firstAdministration = all.findIndex((item) => ADMINISTRATION_SECTIONS.has(item.section));
      if (firstAdministration !== -1) expect(firstAdministration).toBeGreaterThan(lastOperating);
    });
  }

  it('platform administration is the last thing in the sidebar, after business administration', () => {
    const sections = personas[4].sections;
    expect(sections.at(-1)?.key).toBe('platform');
    expect(sections.at(-2)?.key).toBe('business');
  });

  it('partial platform permissions reach only their own group, in registry order', () => {
    const platformRoot = personas[3].sections.find((section) => section.key === 'platform')!.items[0];
    const catalog = platformRoot.children![0];
    expect(catalog.key).toBe('platform-group-catalog');
    expect(catalog.children?.map((page) => page.key)).toEqual(['platform-products', 'platform-meters', 'platform-connectors']);
  });

  it('a workspace with one reachable area is a plain row; with several, an expandable one — never a dropdown of one Home', () => {
    const rows = personas[1].sections.find((section) => section.key === 'workspaces')!.items;
    for (const row of rows) expect(row.children === undefined || row.children.length >= 1).toBe(true);
  });
});

describe('Field follows the business’s declared shape of work', () => {
  const field = (schedulableWork: boolean | undefined, modules = EVERYTHING_MODULES, features = everyFeature()) =>
    projectShell({
      organizationId: ORG,
      enabledModules: new Set(modules),
      featureAvailability: features,
      capabilities: new Set<Capability>(['field.manage']),
      platform: null,
      schedulableWork,
    })
      .flatMap((section) => section.items)
      .find((item) => item.key === 'workspace-field')!;

  it('a business with scheduled work gets Schedule, Resources and Locations beside Work', () => {
    expect(field(true).children?.map((page) => page.key)).toEqual(['work', 'schedule', 'resources', 'locations', 'assets']);
  });

  it('a business with none keeps Work, and Assets by its own entitlement, and loses the three that need a schedule', () => {
    expect(field(false).children?.map((page) => page.key)).toEqual(['work', 'assets']);
    // Assets follows its module and nothing else: without it the workspace is Home and Work.
    expect(field(false, ['billing'], new Set(['price_book'])).children?.map((page) => page.key)).toEqual(['work']);
    // Field Home is never withheld.
    expect(field(false).href).toBe(`/organizations/${ORG}/field`);
  });

  it('an unasked question hides nothing, so a caller that does not know the shape keeps every page', () => {
    expect(field(undefined).children?.map((page) => page.key)).toEqual(['work', 'schedule', 'resources', 'locations', 'assets']);
  });

  it('Schedule configuration follows Schedule — configuring a page the business does not have is not offered', () => {
    const gate = { enabledModules: new Set(EVERYTHING_MODULES), featureAvailability: everyFeature(), capabilities: new Set<Capability>(['field.manage']) };
    const target = configTarget('schedule-configuration');
    expect(configTargetOffered(target, { ...gate, schedulableWork: true })).toBe(true);
    expect(configTargetOffered(target, { ...gate, schedulableWork: false })).toBe(false);
    // Work configuration is where the declaration lives, so it is always offered.
    expect(configTargetOffered(configTarget('work-configuration'), { ...gate, schedulableWork: false })).toBe(true);
  });
});
