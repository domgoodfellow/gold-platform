import { describe, expect, it } from 'vitest';
import { setupGuide, resumeSetupStep } from '@/features/setup/setup-guide';
import type { SetupOverview } from '@/lib/domain/tenancy/lifecycle';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

const empty: SetupOverview = { areas: [], blockers: [], ready: 0, total: 0, recommendedOpen: 0, optionalOpen: 0 };

describe('guided configuration destinations', () => {
  it('does not ask a limited CRM organization for scheduled resources or AI', () => {
    const steps = setupGuide('org', empty, { capabilities: new Set<Capability>(['field.manage']), enabledModules: new Set(), featureAvailability: new Set(['pipeline']), schedulableWork: false });
    const keys = steps.flatMap((step) => step.destinations.map((entry) => entry.key));
    expect(keys).toContain('sales-stages');
    expect(keys).not.toContain('resources');
    expect(keys).not.toContain('locations');
    expect(keys).not.toContain('ai-agents');
    expect(keys).not.toContain('team');
  });
  it('resumes a required gap and does not invent completion from navigation', () => {
    const area = { key: 'billing', label: 'Pricing', area: { href: '/organizations/org/finance/catalog', label: 'Pricing' }, message: 'No prices', state: 'incomplete' as const, importance: 'required' as const };
    const overview = { ...empty, areas: [area], blockers: [area], total: 1 };
    const steps = setupGuide('org', overview, { capabilities: new Set<Capability>(['price.manage']), enabledModules: new Set(['billing']) });
    expect(resumeSetupStep(steps).key).toBe('finance');
    expect(overview.ready).toBe(0);
  });
  it('keeps review available when the actor cannot configure anything', () => {
    expect(setupGuide('org', empty, { capabilities: new Set() }).map((step) => step.key)).toEqual(['review']);
  });
});
