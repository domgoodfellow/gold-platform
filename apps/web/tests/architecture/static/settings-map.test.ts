import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  entryOffered,
  offeredSections,
  SETTINGS_SECTIONS,
  type SettingsEntry,
} from '@/features/settings/settings-map';
import { AREAS } from '@/lib/navigation';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * Settings is the configuration map. What matters about it is that every door on it is a route
 * that exists, that it offers nothing the sidebar's own gates would hide, and that every
 * configuration-only area the sidebar dropped is still reachable from here — otherwise moving a
 * row out of the sidebar would have deleted a way in.
 */

const ROUTES = fileURLToPath(new URL('../../../app/organizations/[organizationId]', import.meta.url));
const entries = SETTINGS_SECTIONS.flatMap((section) => section.entries);

const everything = {
  enabledModules: new Set(['billing', 'integrations', 'reception', 'drafting']),
  featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])),
  capabilities: new Set<Capability>(AREAS.flatMap((area) => area.relevantCapabilities ?? [])),
};
const nothing = {
  enabledModules: new Set<string>(),
  featureAvailability: new Set<string>(),
  capabilities: new Set<Capability>(),
};

describe('the Settings configuration map', () => {
  it('points every entry at a route that exists', () => {
    for (const entry of entries) {
      const segments = entry.path.split('#')[0];
      expect(existsSync(`${ROUTES}/${segments}/page.tsx`), `${entry.key} → ${entry.path}`).toBe(true);
    }
  });

  it('has unique keys, so anything that targets a destination can name it', () => {
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
    expect(new Set(SETTINGS_SECTIONS.map((section) => section.key)).size).toBe(SETTINGS_SECTIONS.length);
  });

  it('organizes by business concern, in the documented order', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.title)).toEqual([
      'Business',
      'Work & scheduling',
      'Services & pricing',
      'Customers & data',
      'People & access',
      'Brand & public presence',
      'Connections',
      'Products & features',
      'Plan & usage',
      'Setup & launch',
    ]);
  });

  it('keeps every configuration-only area reachable, since none of them has a sidebar row any more', () => {
    for (const area of AREAS.filter((candidate) => candidate.sidebar === false)) {
      expect(
        entries.some((entry) => entry.area === area.segment),
        `${area.segment} left the sidebar and is not on the Settings map`,
      ).toBe(true);
    }
  });

  it('names only areas that exist', () => {
    for (const entry of entries) {
      if (entry.area) expect(AREAS.some((area) => area.segment === entry.area), entry.key).toBe(true);
    }
  });

  it('offers a kernel entry to everyone and a gated entry only where the sidebar’s own gates pass', () => {
    const general = entries.find((entry) => entry.key === 'general') as SettingsEntry;
    expect(entryOffered(general, nothing)).toBe(true);

    const pricing = entries.find((entry) => entry.key === 'pricing') as SettingsEntry;
    expect(entryOffered(pricing, everything)).toBe(true);
    // Not entitled, and entitled but without the capability: both hide it.
    expect(entryOffered(pricing, nothing)).toBe(false);
    expect(entryOffered(pricing, { ...everything, capabilities: new Set() })).toBe(false);
    expect(entryOffered(pricing, { ...everything, featureAvailability: new Set() })).toBe(false);
  });

  it('drops a section left with nothing to offer, rather than printing an empty heading', () => {
    const shown = offeredSections(nothing).map((section) => section.key);
    expect(shown).not.toContain('pricing');
    expect(shown).not.toContain('people');
    expect(shown).toContain('business');
  });
});
