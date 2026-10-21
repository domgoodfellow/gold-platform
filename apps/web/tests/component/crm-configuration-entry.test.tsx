// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigureMenu } from '@/components/controls/configure-menu';
import { AREAS, CONFIG_TARGETS, MODULES, workspaceConfigureItems, type ConfigGate } from '@/lib/navigation';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { resolveLocation, type ResolvedLocation } from '@/lib/route/page-location';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/** Package 3A: how CRM configuration is found — Home's Configure menu, plain-text Configuration ancestry. */

const ORG = 'org';
const all = new Set<Capability>(CONFIG_TARGETS.flatMap((target) => [...target.permission, ...(target.requiresAll ?? [])]) as Capability[]);
const gate = (capabilities: Set<Capability> = all, extra: Partial<ConfigGate> = {}): ConfigGate => ({
  enabledModules: new Set(MODULES.map((module) => module.key)),
  featureAvailability: new Set([...AREAS.flatMap((area) => area.featureKeys ?? []), ...CONFIG_TARGETS.flatMap((target) => target.featureKeys ?? [])]),
  capabilities,
  schedulableWork: true,
  ...extra,
});

afterEach(cleanup);

describe('CRM Home Configure control (ConfigureMenu over workspaceConfigureItems)', () => {
  it('offers CRM\'s three doors, in registry order, to a member who may configure them all', () => {
    expect(workspaceConfigureItems(ORG, 'crm', gate()).map((item) => [item.label, item.href])).toEqual([
      ['Relationship stages', `/organizations/${ORG}/sales/configuration/relationship-stages`],
      ['Opportunity stages', `/organizations/${ORG}/sales/configuration/opportunity-stages`],
      ['Customer fields', `/organizations/${ORG}/sales/configuration/fields`],
    ]);
  });

  it('offers nothing to a member without configuration rights, and nothing a business is not entitled to', () => {
    expect(workspaceConfigureItems(ORG, 'crm', gate(new Set()))).toEqual([]);
    // Relationship stages are entitled by the relationship pipeline's features; without them that door is not offered.
    const pipelineFeatures = new Set(['pipeline', 'configurable_stages', 'qualification_state']);
    const noPipeline = gate(all, { featureAvailability: new Set([...gate().featureAvailability!].filter((key) => !pipelineFeatures.has(key))) });
    expect(workspaceConfigureItems(ORG, 'crm', noPipeline).map((item) => item.key)).toEqual(['opportunity-stages', 'customer-fields']);
  });

  it('renders no control at all for zero doors', () => {
    const { container } = render(<ConfigureMenu items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links straight to the only door, named for what it opens', () => {
    const fields = workspaceConfigureItems(ORG, 'crm', gate()).find((item) => item.key === 'customer-fields')!;
    render(<ConfigureMenu items={[fields]} />);
    expect(screen.queryByRole('button', { name: 'Configure' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Customer fields' })).toHaveAttribute('href', `/organizations/${ORG}/sales/configuration/fields`);
  });

  it('opens a menu of direct links from the keyboard, and Escape returns focus to the control', async () => {
    const user = userEvent.setup();
    render(<ConfigureMenu items={workspaceConfigureItems(ORG, 'crm', gate())} />);
    const trigger = screen.getByRole('button', { name: 'Configure' });
    trigger.focus();
    await user.keyboard('{Enter}');
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => [item.textContent, item.getAttribute('href')])).toEqual([
      ['Relationship stages', `/organizations/${ORG}/sales/configuration/relationship-stages`],
      ['Opportunity stages', `/organizations/${ORG}/sales/configuration/opportunity-stages`],
      ['Customer fields', `/organizations/${ORG}/sales/configuration/fields`],
    ]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe('CRM configuration page identity', () => {
  it('names Configuration as a plain-text ancestor on a CRM configuration page', () => {
    expect(workspaceConfigCrumbs(ORG, 'sales-stages', gate())).toEqual([
      { label: 'CRM', href: `/organizations/${ORG}/sales` },
      { label: 'Configuration', href: undefined },
    ]);
    // No workspace has a landing to link to (Batch A).
    expect(workspaceConfigCrumbs(ORG, 'call-setup', gate())[1]).toEqual({ label: 'Configuration' });
  });

  it('resolves CRM configuration under a non-linking Configuration level, with Up going to CRM', () => {
    const location = resolveLocation({ pathname: `/organizations/${ORG}/sales/configuration/relationship-stages`, access: { gate: gate() } }) as ResolvedLocation;
    expect(location.status).toBe('resolved');
    const configuration = location.trail.find((crumb) => crumb.label === 'Configuration');
    expect(configuration).toBeDefined();
    expect(configuration?.href).toBeUndefined();
    expect(location.up).toBe(`/organizations/${ORG}/sales`);
  });
});
