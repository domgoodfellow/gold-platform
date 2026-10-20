import { describe, expect, it } from 'vitest';
import { AREAS, CONFIG_TARGETS } from '@/lib/navigation';
import { projectShell, workspaceShortcuts } from '@/lib/shell';
import { projectBusinessNavigation } from '@/lib/application/shell/business-navigation';
import { ALL_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * Work Home's "Manage Work" shortcuts: a chosen set of the workspace's own navigation, never a list of
 * its own. Each shortcut must be a registered destination this person may open, carry the label the
 * sidebar shows, and disappear when it is unavailable.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const base = `/organizations/${ORG}`;
const input = (capabilities: readonly Capability[], overrides: { withoutFeatures?: string[]; schedulableWork?: boolean } = {}) => ({
  organizationId: ORG,
  enabledModules: new Set(['assets']),
  // Areas naming features are gated by the resolved features, as in the application.
  featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? []).filter((key) => !(overrides.withoutFeatures ?? []).includes(key))),
  capabilities: new Set(capabilities),
  schedulableWork: overrides.schedulableWork ?? true,
});
const pick = { destinations: ['work', 'resources', 'locations', 'assets'], calendar: true, configuration: ['schedule-configuration'] } as const;
const shortcuts = (sections: ReturnType<typeof projectShell>) => workspaceShortcuts(sections, 'field', pick).map(({ key, label, href }) => ({ key, label, href }));

describe('Work Home shortcuts', () => {
  it('offers the registered destinations, calendar and hours configuration a manager may use, with registry labels', () => {
    expect(shortcuts(projectShell(input(ALL_CAPABILITIES)))).toEqual([
      { key: 'work', label: 'Work items', href: `${base}/work` },
      { key: 'resources', label: 'Resources', href: `${base}/resources` },
      { key: 'locations', label: 'Locations', href: `${base}/locations` },
      { key: 'assets', label: 'Equipment & Assets', href: `${base}/assets` },
      { key: 'work-calendar', label: 'Work calendar', href: `${base}/field/calendar` },
      { key: 'schedule-configuration', label: 'Scheduling & hours', href: `${base}/schedule/configuration` },
    ]);
  });

  it('offers no hours configuration where the business schedules no work, since that page refuses there', () => {
    const keys = shortcuts(projectShell(input(ALL_CAPABILITIES, { schedulableWork: false }))).map((item) => item.key);
    expect(keys).not.toContain('schedule-configuration');
    expect(keys).not.toContain('resources');
    expect(keys).not.toContain('locations');
    expect(keys).toContain('work');
  });

  it('offers no configuration to a member who may not configure, and no Assets to a business without them', () => {
    const operator = shortcuts(projectShell(input(ALL_CAPABILITIES.filter((capability) => !['field.manage', 'organization.manage'].includes(capability)), { withoutFeatures: ['assets'] }))).map((item) => item.key);
    expect(operator).not.toContain('schedule-configuration');
    expect(operator).not.toContain('assets');
  });

  it('shows the business’s own destination label, exactly as the sidebar does', () => {
    const sections = projectBusinessNavigation(input(ALL_CAPABILITIES), { revision: 1, nouns: {}, navigation: [], labels: { work: 'Jobs' } });
    expect(shortcuts(sections).find((item) => item.key === 'work')?.label).toBe('Jobs');
  });

  it('never repeats the workspace Home and never invents an address', () => {
    const items = shortcuts(projectShell(input(ALL_CAPABILITIES)));
    expect(items.map((item) => item.href)).not.toContain(`${base}/field`);
    const registered = new Set([...AREAS.map((area) => `${base}/${area.route ?? area.segment}`), ...CONFIG_TARGETS.map((target) => `${base}/${target.path}`)]);
    expect(items.filter((item) => !registered.has(item.href))).toEqual([]);
  });
});
