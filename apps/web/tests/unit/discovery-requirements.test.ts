import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_REQUIREMENTS,
  discoveryRequirement,
  discoveryRequirementsFor,
} from '@/lib/domain/customers/discovery-requirements';

/**
 * The catalogue itself, not a database — proves it stays internally coherent as requirements are
 * added: every `dependsOn` names a real requirement, every requirement has somewhere it applies,
 * and no key repeats.
 */
describe('discovery requirements', () => {
  it('has no duplicate keys', () => {
    const keys = DISCOVERY_REQUIREMENTS.map((requirement) => requirement.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names a real requirement in every dependsOn', () => {
    for (const requirement of DISCOVERY_REQUIREMENTS) {
      if (!requirement.dependsOn) continue;
      expect(() => discoveryRequirement(requirement.dependsOn!)).not.toThrow();
    }
  });

  it('applies to at least one stage', () => {
    for (const requirement of DISCOVERY_REQUIREMENTS) {
      expect(requirement.applicableStages.length).toBeGreaterThan(0);
    }
  });

  it('filters by stage', () => {
    const salesDiscovery = discoveryRequirementsFor('sales_discovery');
    expect(salesDiscovery).toHaveLength(DISCOVERY_REQUIREMENTS.length);

    const publicIntake = discoveryRequirementsFor('public_intake');
    expect(publicIntake.map((requirement) => requirement.key)).toEqual(['productInterest', 'teamAccess', 'existingSoftware']);

    // A stage nothing asks anything of yet still answers honestly, rather than throwing.
    expect(discoveryRequirementsFor('operational_setup')).toEqual([]);
  });

  it('throws on an unknown key rather than returning nothing', () => {
    // @ts-expect-error deliberately wrong key
    expect(() => discoveryRequirement('not-a-real-key')).toThrow();
  });
});
