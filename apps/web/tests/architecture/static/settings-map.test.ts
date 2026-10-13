import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  entryOffered,
  offeredSections,
  SETTINGS_SECTIONS,
  type SettingsEntry,
} from '@/features/settings/settings-map';
import { AREAS, CONFIG_TARGETS, configTarget, configTargetOffered } from '@/lib/navigation';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * Settings is the configuration map. What matters about it is that every door on it is a route
 * that exists, that each door is offered by **configuration** permission and entitlement — never by
 * the permission to operate the workspace it belongs to — and that every configuration-only area
 * the sidebar dropped is still reachable from here.
 */

const ROUTES = fileURLToPath(new URL('../../../app/organizations/[organizationId]', import.meta.url));
const entries = SETTINGS_SECTIONS.flatMap((section) => section.entries);

const everythingEntitled = {
  enabledModules: new Set(['billing', 'integrations', 'reception', 'drafting']),
  featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])),
};
const nothingEntitled = { enabledModules: new Set<string>(), featureAvailability: new Set<string>() };
const allPermissions = new Set<Capability>(CONFIG_TARGETS.flatMap((target) => target.permission));

describe('the Settings configuration map', () => {
  it('points every entry at a route that exists', () => {
    for (const entry of entries) {
      const segments = entry.path.split('#')[0];
      const route = segments === 'ai/agents' ? 'ai/[view]' : segments;
      expect(existsSync(`${ROUTES}/${route}/page.tsx`), `${entry.key} → ${entry.path}`).toBe(true);
    }
  });

  it('has unique keys, so anything that targets a destination can name it', () => {
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.key)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it('lists each destination once, so a grid and a list can never show a door twice', () => {
    expect(new Set(entries.map((entry) => entry.path)).size).toBe(entries.length);
  });

  it('organizes by business concern, in the documented order', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.title)).toEqual([
      'General',
      'Work & scheduling',
      'Pricing',
      'Customer data',
      'Brand & public presence',
      'Communications configuration',
      'AI & Automations',
      'Features',
    ]);
  });

  it('is built from configuration targets: one path per key, declared once', () => {
    for (const entry of entries) expect(entry.path).toBe(configTarget(entry.key).path);
    expect(new Set(CONFIG_TARGETS.map((target) => target.key)).size).toBe(CONFIG_TARGETS.length);
    // Every target is on the map, and none is a door nobody may open.
    expect(CONFIG_TARGETS.filter((target) => target.scope === 'organization' && target.key !== 'setup' && target.directory !== false).map((target) => target.key).sort()).toEqual(entries.map((entry) => entry.key).sort());
    for (const target of CONFIG_TARGETS) expect(target.permission.length, target.key).toBeGreaterThan(0);
  });

  it('keeps every configuration-only area reachable, since none of them has a sidebar row any more', () => {
    // Setup is its own SETUP-lifecycle destination, Insights is an operating page reached
    // contextually from each workspace's Home and from PageHeader's Insights support mode
    // (`areaAvailable('insights', ...)`), and Website, Forms and Templates are Studio's own operating pages, reached from
    // Studio Home (D68) — none of them is a Settings *configuration* door.
    // `help` is product help opened from the account menu: not configuration, so not a door on the map.
    const settingsOwned: Record<string, string> = {
      pricing: 'pricing',
      fields: 'custom-fields',
      roles: 'team',
      integrations: 'integrations',
    };
    for (const area of AREAS.filter((candidate) => candidate.group === 'settings' && candidate.sidebar === false && candidate.segment !== 'setup' && candidate.segment !== 'help')) {
      expect(
        CONFIG_TARGETS.some((target) => target.key === settingsOwned[area.segment] || target.path.split(/[/#]/)[0] === area.segment),
        `${area.segment} left the sidebar and is not on the Settings map`,
      ).toBe(true);
    }
  });

  it('Organization never contains a peer Settings scope', () => {
    for (const entry of entries) {
      expect(configTarget(entry.key).scope, entry.key).toBe('organization');
      expect(entry.path, entry.key).not.toMatch(/^settings\/(account|access|connections|secrets|plan)(?:[/?#]|$)/);
    }
    for (const peer of ['team', 'integrations', 'secrets', 'plan']) expect(entries.map((entry) => entry.key)).not.toContain(peer);
    expect(configTarget('team').scope).toBe('access');
    expect(configTarget('integrations').scope).toBe('connections');
    expect(configTarget('secrets').scope).toBe('connections');
    expect(configTarget('plan').scope).toBe('plan');
  });

  it('borrows only an entitlement from a workspace, never its operating permission', () => {
    for (const target of CONFIG_TARGETS.filter((candidate) => candidate.entitledBy)) {
      expect(AREAS.some((area) => area.segment === target.entitledBy), target.key).toBe(true);
    }
  });
});

describe('configuring is not operating', () => {
  const callSetup = configTarget('call-setup');
  const callsArea = AREAS.find((area) => area.segment === 'calls')!;

  it('offers call setup to somebody who may configure but not place calls', () => {
    expect(callsArea.relevantCapabilities).toEqual(['call.place']);
    const configureOnly = { ...everythingEntitled, capabilities: new Set<Capability>(['field.manage']) };
    expect(configTargetOffered(callSetup, configureOnly)).toBe(true);
  });

  it('does not offer it to somebody who may only place calls', () => {
    const operateOnly = { ...everythingEntitled, capabilities: new Set<Capability>(['call.place']) };
    expect(configTargetOffered(callSetup, operateOnly)).toBe(false);
  });

  it('does not conjure the entitlement from a broad role', () => {
    const everyPermissionNoProduct = { ...nothingEntitled, capabilities: allPermissions };
    expect(configTargetOffered(callSetup, everyPermissionNoProduct)).toBe(false);
  });

  it('gates every kernel entry on its own configuration permission, never on being a member', () => {
    for (const key of ['general', 'branding', 'domains', 'communications']) {
      const target = configTarget(key);
      expect(target.entitledBy, key).toBeUndefined();
      expect(configTargetOffered(target, { ...nothingEntitled, capabilities: new Set() }), key).toBe(false);
      expect(configTargetOffered(target, { ...nothingEntitled, capabilities: new Set<Capability>(['organization.manage']) }), key).toBe(true);
    }
  });

  it('keeps Setup kernel: reachable without the drafting module, by launching or asking for a draft', () => {
    const setup = configTarget('setup');
    expect(setup.entitledBy).toBeUndefined();
    expect(configTargetOffered(setup, { ...nothingEntitled, capabilities: new Set<Capability>(['organization.manage']) })).toBe(true);
    expect(configTargetOffered(setup, { ...nothingEntitled, capabilities: new Set<Capability>(['configuration.propose']) })).toBe(true);
    expect(configTargetOffered(setup, { ...nothingEntitled, capabilities: new Set<Capability>(['call.place']) })).toBe(false);
  });

  // "Calls and sales stages" used to be one combined Settings entry that pointed at Communications
  // and never actually reached stage configuration. Split: `call-setup` stays Communications' own
  // door (now a real `/comms/configuration/calling` route, never `calls#setup`); `sales-stages` is CRM's.
  it('splits sales stages out as its own CRM-owned target, never routed through Communications', () => {
    const salesStages = configTarget('sales-stages');
    expect(salesStages.workspace).toBe('crm');
    expect(salesStages.path).toBe('sales/configuration/relationship-stages');
    expect(salesStages.entitledBy).toBe('pipeline');
    expect(AREAS.some((area) => area.segment === 'pipeline')).toBe(true);

    const configureOnly = { ...everythingEntitled, capabilities: new Set<Capability>(['field.manage']) };
    expect(configTargetOffered(salesStages, configureOnly)).toBe(true);
    // customer.update is Pipeline's operating capability (moving a customer between stages), never its configuring one.
    const operateOnly = { ...everythingEntitled, capabilities: new Set<Capability>(['customer.update']) };
    expect(configTargetOffered(salesStages, operateOnly)).toBe(false);
    const everyPermissionNoProduct = { ...nothingEntitled, capabilities: allPermissions };
    expect(configTargetOffered(salesStages, everyPermissionNoProduct)).toBe(false);
  });

  it('keeps Call setup a real Settings route, not an operational page plus a URL fragment', () => {
    expect(callSetup.path).toBe('comms/configuration/calling');
    expect(callSetup.path).not.toContain('#');
  });
});

describe('offered entries and sections', () => {
  it('offers an entry only when it is entitled and the member may configure it', () => {
    const pricing = entries.find((entry) => entry.key === 'pricing') as SettingsEntry;
    const permitted = { ...everythingEntitled, capabilities: new Set<Capability>(['price.manage']) };
    expect(entryOffered(pricing, permitted)).toBe(true);
    // Not entitled, and entitled but without the permission: both hide it.
    expect(entryOffered(pricing, { ...nothingEntitled, capabilities: new Set<Capability>(['price.manage']) })).toBe(false);
    expect(entryOffered(pricing, { ...everythingEntitled, capabilities: new Set() })).toBe(false);
    expect(
      entryOffered(pricing, { ...everythingEntitled, featureAvailability: new Set(), capabilities: new Set<Capability>(['price.manage']) }),
    ).toBe(false);
  });

  it('offers a member with no configuration authority nothing, rather than a kernel free-for-all', () => {
    expect(offeredSections({ ...everythingEntitled, capabilities: new Set() })).toEqual([]);
  });

  it('drops a section left with nothing to offer, rather than printing an empty heading', () => {
    const shown = offeredSections({ ...nothingEntitled, capabilities: new Set<Capability>(['organization.manage']) }).map(
      (section) => section.key,
    );
    expect(shown).toContain('business');
    expect(shown).not.toContain('pricing');
    expect(shown).not.toContain('people');
  });
});
