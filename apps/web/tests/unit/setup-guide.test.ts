import { describe, expect, it } from 'vitest';
import { setupGuide, resumeSetupStep } from '@/features/setup/setup-guide';
import type { SetupOverview } from '@/lib/domain/tenancy/lifecycle';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { configurationOwnerPath, setupReturnHref, withSetupContext } from '@/lib/route/setup-context';

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
  it('offers the actual number and customer-payment owners only to authorized roles', () => {
    const areas = [
      { key: 'reception', label: 'Calling', area: { href: '/organizations/org/comms/configuration/numbers', label: 'Numbers & assignments' }, message: 'No calling number', state: 'incomplete' as const, importance: 'recommended' as const },
      { key: 'card_payments', label: 'Card payments', area: { href: '/organizations/org/settings/payments', label: 'Customer payments' }, message: 'No processor', state: 'incomplete' as const, importance: 'recommended' as const },
    ];
    const overview = { ...empty, areas, total: 2 };
    const gate = { capabilities: new Set<Capability>(['organization.manage']), enabledModules: new Set(['reception', 'billing']) };
    const steps = setupGuide('org', overview, gate);
    expect(steps.find(step => step.key === 'communications')?.areas).toEqual([areas[0]]);
    expect(steps.find(step => step.key === 'finance')?.areas).toEqual([areas[1]]);
    const limited = setupGuide('org', overview, { ...gate, capabilities: new Set<Capability>(['field.manage']) });
    expect(limited.flatMap(step => step.destinations.map(entry => entry.key))).not.toContain('phone-numbers');
    expect(limited.flatMap(step => step.destinations.map(entry => entry.key))).not.toContain('payments');
  });
  it('keeps a starting-stage deep link in Operations and returns to the same setup step', () => {
    const area = { key: 'work', label: 'Work items', area: { href: '/organizations/org/work/configuration?type=t1&tab=workflow', label: 'Work types' }, message: 'Needs a starting stage', state: 'incomplete' as const, importance: 'optional' as const };
    const steps = setupGuide('org', { ...empty, areas: [area], total: 1 }, { capabilities: new Set<Capability>(['field.manage']) });
    expect(steps.find(step => step.key === 'operations')?.areas).toEqual([area]);
    const href = withSetupContext(area.area.href, 'operations');
    expect(href).toBe('/organizations/org/work/configuration?type=t1&tab=workflow&setupStep=operations');
    expect(configurationOwnerPath(href)).toBe('/organizations/org/work/configuration');
    expect(setupReturnHref('/organizations/org/work/configuration', 'operations')).toBe('/organizations/org/setup?step=operations');
    expect(setupReturnHref('/platform/providers', 'operations')).toBeNull();
    expect(setupReturnHref('/organizations/org/work', 'https://outside.test')).toBeNull();
    expect(withSetupContext('/organizations/org/settings/general#regional-heading', 'business')).toBe('/organizations/org/settings/general?setupStep=business#regional-heading');
  });
});
