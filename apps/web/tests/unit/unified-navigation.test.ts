import { describe, expect, it } from 'vitest';
import { AREAS, areaHref } from '@/lib/navigation';
import { activeItemKey, projectShell, reachableItems, withAdministration, withInterfaceDesign, type NavItem, type ShellInput, type ShellSection } from '@/lib/shell';
import { OPERATIONS_WORKSPACES, unifiedNavigation } from '@/lib/unified-navigation';
import { INTERFACE_DESIGN_CAPABILITY, interfaceDesignHref, navigationLayoutFor } from '@/lib/interface-design';
import { PLATFORM_CAPABILITIES, type PlatformCapability } from '@/lib/domain/platform/permissions';
import { ALL_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';

/** ADR-056: the unified layout arranges the authorized projection; it never widens it. */
const ORG = '11111111-1111-4111-8111-111111111111';
const base = `/organizations/${ORG}`;
const MODULES = ['billing', 'assets', 'automations', 'reporting', 'reception', 'integrations', 'card_payments'];
const gate = (capabilities: readonly Capability[] = ALL_CAPABILITIES, overrides: Partial<ShellInput> = {}): ShellInput => ({
  organizationId: ORG, enabledModules: new Set(MODULES), featureAvailability: new Set(AREAS.flatMap((area) => area.featureKeys ?? [])), capabilities: new Set(capabilities), schedulableWork: true, ...overrides,
});
const project = (capabilities?: readonly Capability[], overrides?: Partial<ShellInput>) => projectShell(gate(capabilities, overrides));
const flat = (sections: readonly ShellSection[]): NavItem[] => {
  const walk = (item: NavItem): NavItem[] => [item, ...(item.children ?? []).flatMap(walk)];
  return sections.flatMap((section) => section.items.flatMap(walk));
};
const group = (sections: readonly ShellSection[], key: string) => sections.flatMap((section) => section.items).find((item) => item.key === key);

describe('the operations sidebar', () => {
  const view = unifiedNavigation(project(), `${base}/crm/contacts`);

  it('keeps the six operating workspaces as groups in one sidebar, then Studio and Settings', () => {
    expect(view.context).toBeNull();
    expect(view.sections.map((section) => section.key)).toEqual(['operations', 'creation']);
    expect(view.sections[0].items.map((item) => item.key)).toEqual(OPERATIONS_WORKSPACES.map((key) => `workspace-${key}`));
    expect(view.sections[1].items.map((item) => [item.key, item.href])).toEqual([['workspace-studio', `${base}/studio`], ['settings', `${base}/settings`]]);
    // AI and Automations are reached through Studio, not as operating groups.
    expect(flat(view.sections).map((item) => item.key)).not.toContain('workspace-ai');
    expect(flat(view.sections).map((item) => item.key)).not.toContain('workspace-automations');
  });

  it('links each heading to its Dashboard exactly once, and never repeats Dashboard as a child', () => {
    for (const row of view.sections[0].items) {
      expect(row.exact, row.key).toBe(true);
      expect(row.children?.some((child) => child.href === row.href), row.key).toBe(false);
      expect(row.children?.some((child) => child.label === 'Dashboard'), row.key).toBe(false);
    }
    expect(group(view.sections, 'workspace-crm')).toMatchObject({ label: 'CRM', href: `${base}/crm` });
    expect(group(view.sections, 'workspace-crm')!.children!.map((child) => child.label)).toEqual(['Contacts', 'Pipeline']);
    expect(group(view.sections, 'workspace-communications')!.children!.map((child) => child.label).slice(0, 2)).toEqual(['Dialer', 'Conversations']);
    expect(group(view.sections, 'workspace-field')!.children!.map((child) => child.label)).toEqual(['Work items', 'Schedule', 'Resources', 'Locations', 'Equipment & Assets']);
    expect(group(view.sections, 'workspace-finance')!.children!.map((child) => child.label)).toEqual(['Catalog & Pricing', 'Quotes', 'Invoices', 'Payments', 'Financial reports']);
  });

  it('keeps keys unique within the sidebar, so one selected row never marks another workspace', () => {
    const keys = flat(view.sections).map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('offers no address the contextual projection does not already offer this person', () => {
    for (const capabilities of [ALL_CAPABILITIES, ['customer.read'], ['field.manage'], ['call.place'], [] as Capability[]] as const) {
      const sections = project(capabilities);
      const offered = new Set(reachableItems(sections).flatMap((item) => [item.href, ...(item.activeHrefs ?? [])]));
      for (const path of ['crm/contacts', 'ai/agents', 'automations/workflows']) {
        for (const item of flat(unifiedNavigation(sections, `${base}/${path}`).sections)) {
          if (item.key === 'settings') continue;
          expect(offered.has(item.href), `${capabilities.join(',')} ${path}: ${item.href}`).toBe(true);
        }
      }
    }
  });

  it.each([
    ['crm/contacts/123', 'workspace-crm', 'workspace-crm/customers'],
    ['crm/opportunities/123', 'workspace-crm', 'workspace-crm/opportunity-pipeline'],
    ['calls', 'workspace-communications', 'workspace-communications/calls'],
    ['support/cases', 'workspace-support', 'workspace-support/support-cases'],
    ['schedule', 'workspace-field', 'workspace-field/schedule'],
    ['work/123', 'workspace-field', 'workspace-field/work'],
    ['crm/configuration/fields', 'workspace-crm', 'workspace-crm/customers'],
    ['crm', 'workspace-crm', 'workspace-crm'],
  ])('at %s, opens %s and selects %s', (path, owner, active) => {
    const navigation = unifiedNavigation(project(), `${base}/${path}`);
    expect(navigation.owner).toBe(owner);
    expect(activeItemKey(navigation.sections, `${base}/${path}`)).toBe(active);
  });

  it('opens the owning group for a contextual page that has no row of its own', () => {
    const navigation = unifiedNavigation(project(), `${base}/crm/tasks`);
    expect(navigation.owner).toBe('workspace-crm');
    expect(activeItemKey(navigation.sections, `${base}/crm/tasks`)).toBeNull();
  });

  it('filters entitlement, role and shape exactly as the contextual layout does', () => {
    const noContacts = unifiedNavigation(project(ALL_CAPABILITIES.filter((capability) => capability !== 'customer.read')), `${base}/home`);
    // Contacts is withheld; its editors stay reachable through CRM's Settings, as in the contextual layout.
    expect(group(noContacts.sections, 'workspace-crm')!.children!.map((child) => child.label)).toEqual(['Pipeline', 'Settings']);
    const noMarketing = unifiedNavigation(project(ALL_CAPABILITIES.filter((capability) => !capability.startsWith('marketing.'))), `${base}/home`);
    expect(group(noMarketing.sections, 'workspace-marketing')).toBeUndefined();
    const noReception = unifiedNavigation(project(ALL_CAPABILITIES, { enabledModules: new Set(), featureAvailability: new Set() }), `${base}/home`);
    // Not entitled to calling or messaging: no Dashboard, Dialer or Conversations, only the settings a manager still owns.
    const comms = group(noReception.sections, 'workspace-communications')!;
    expect(comms.group).toBe(true);
    expect(flat([{ key: 'operations', label: null, items: [comms] }]).some((item) => [`${base}/comms`, `${base}/calls`, `${base}/comms/inbox`].includes(item.href))).toBe(false);
    const notScheduled = unifiedNavigation(project(ALL_CAPABILITIES, { schedulableWork: false }), `${base}/home`);
    expect(group(notScheduled.sections, 'workspace-field')!.children!.map((child) => child.label)).not.toContain('Schedule');
  });

  it('gives a configuration-only member a heading with no Dashboard link', () => {
    const navigation = unifiedNavigation(project(['field.manage']), `${base}/comms/configuration/calling`);
    const comms = group(navigation.sections, 'workspace-communications')!;
    expect(comms.group).toBe(true);
    expect(comms.exact).toBeUndefined();
    expect(flat(navigation.sections).some((item) => item.href === `${base}/comms`)).toBe(false);
    expect(navigation.owner).toBe('workspace-communications');
  });

  it('keeps another organization’s address out of the selection', () => {
    const navigation = unifiedNavigation(project(), '/organizations/22222222-2222-4222-8222-222222222222/crm/contacts');
    expect(navigation.context).toBeNull();
    expect(navigation.owner).toBeNull();
    expect(activeItemKey(navigation.sections, '/organizations/22222222-2222-4222-8222-222222222222/crm/contacts')).toBeNull();
  });
});

describe('Studio, the creation context', () => {
  it.each(['studio', 'studio/forms/123', 'ai', 'ai/agents/123', 'automations/workflows/new'])('enters Studio at %s', (path) => {
    const navigation = unifiedNavigation(project(), `${base}/${path}`);
    expect(navigation.context?.workspace).toMatchObject({ key: 'workspace-studio', label: 'Studio' });
    expect(navigation.context!.sections[0].items.map((item) => item.key)).toEqual(['workspace-dashboard', 'studio-experiences', 'workspace-ai', 'workspace-automations', 'workspace-configuration']);
  });

  it('links the existing editors without moving their routes', () => {
    const items = unifiedNavigation(project(), `${base}/ai/agents/123`).context!.sections[0].items;
    expect(items[0]).toMatchObject({ label: 'Overview', href: `${base}/studio` });
    expect(group([{ key: 'creation', label: null, items }], 'studio-experiences')!.children!.map((child) => child.href)).toEqual(['studio/website', 'studio/portal', 'studio/forms', 'studio/templates'].map((path) => `${base}/${path}`));
    const ai = group([{ key: 'creation', label: null, items }], 'workspace-ai')!;
    expect(ai.href).toBe(`${base}/ai`);
    expect(ai.children!.map((child) => child.href)).toEqual(['ai/agents', 'ai/deployments', 'ai/knowledge', 'ai/tools', 'ai/activity', 'ai/evaluations'].map((path) => `${base}/${path}`));
    const automations = group([{ key: 'creation', label: null, items }], 'workspace-automations')!;
    expect(automations.children!.map((child) => child.href)).toEqual(['automations/workflows', 'automations/messages', 'automations/runs'].map((path) => `${base}/${path}`));
    expect(activeItemKey(unifiedNavigation(project(), `${base}/ai/agents/123`).sections, `${base}/ai/agents/123`)).toBe('ai-agents');
    expect(activeItemKey(unifiedNavigation(project(), `${base}/automations/workflows/new`).sections, `${base}/automations/workflows/new`)).toBe('automation-rules');
  });

  it('offers an ordinary member only the Studio tools their role permits', () => {
    const member = project(['customer.read', 'call.place']);
    const items = unifiedNavigation(member, `${base}/studio`).context!.sections[0].items;
    expect(items.map((item) => item.key)).toEqual(['workspace-dashboard', 'workspace-ai']);
    expect(group([{ key: 'creation', label: null, items }], 'workspace-ai')!.children!.map((child) => child.key)).toEqual(['ai-activity', 'ai-evaluations']);
    expect(flat(unifiedNavigation(member, `${base}/studio`).sections).some((item) => item.key.startsWith('studio-interface'))).toBe(false);
  });
});

describe('GildOps-only interface design', () => {
  const staff = (permissions: readonly PlatformCapability[]) => withInterfaceDesign(withAdministration(project(), ORG, new Set(permissions)), ORG);

  it('adds Interface design → Navigation to Studio, and only there', () => {
    const sections = staff(PLATFORM_CAPABILITIES);
    const studio = unifiedNavigation(sections, interfaceDesignHref(ORG));
    expect(studio.context!.sections[0].items.map((item) => item.key)).toContain('studio-interface');
    expect(activeItemKey(studio.sections, interfaceDesignHref(ORG))).toBe('studio-interface-navigation');
    expect(flat(unifiedNavigation(sections, `${base}/home`).sections).some((item) => item.key.startsWith('studio-interface'))).toBe(false);
    expect(flat(unifiedNavigation(project(), `${base}/studio`).sections).some((item) => item.key.startsWith('studio-interface'))).toBe(false);
  });

  it('honours a stored preview only with the interface-design permission', () => {
    expect(navigationLayoutFor('unified', new Set([INTERFACE_DESIGN_CAPABILITY]))).toBe('unified');
    expect(navigationLayoutFor('unified', new Set(PLATFORM_CAPABILITIES.filter((capability) => capability !== INTERFACE_DESIGN_CAPABILITY)))).toBe('contextual');
    expect(navigationLayoutFor('unified', null)).toBe('contextual');
    expect(navigationLayoutFor('anything', new Set(PLATFORM_CAPABILITIES))).toBe('contextual');
    expect(navigationLayoutFor(undefined, new Set(PLATFORM_CAPABILITIES))).toBe('contextual');
  });

  it('keeps Administration a separate entered context with its existing registry', () => {
    const sections = staff(PLATFORM_CAPABILITIES);
    const operations = unifiedNavigation(sections, `${base}/home`);
    expect(operations.sections.at(-1)!.items.map((item) => [item.key, item.href])).toEqual([['administration', '/platform']]);
    const inside = unifiedNavigation(sections, '/platform/providers');
    expect(inside.context?.workspace.key).toBe('administration');
    expect(activeItemKey(inside.sections, '/platform/providers')).toBe('platform-providers');
    expect(flat(inside.sections).some((item) => item.key.startsWith('workspace-'))).toBe(false);
    expect(flat(unifiedNavigation(project(), `${base}/home`).sections).some((item) => item.key === 'administration')).toBe(false);
  });
});

it('resolves every operating group to its registered Dashboard', () => {
  for (const row of unifiedNavigation(project(), `${base}/home`).sections[0].items) {
    expect(row.href.startsWith(`${base}/`)).toBe(true);
    expect(AREAS.some((area) => areaHref(ORG, area.segment) === row.href)).toBe(true);
  }
});
