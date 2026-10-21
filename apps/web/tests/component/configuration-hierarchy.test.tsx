// @vitest-environment jsdom
vi.mock('@/features/tenancy/business-profile-settings', () => ({ BusinessProfileSettings: () => null }));
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfigurationLayout from '@/app/organizations/[organizationId]/sales/configuration/layout';
import { workspaceConfigureItems, AREAS, type WorkspaceKey } from '@/lib/navigation';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import GeneralPage from '@/app/organizations/[organizationId]/settings/general/page';
import { EMPTY_IDENTITY } from '@/lib/domain/tenancy/identity';

const context = vi.hoisted(() => ({
  organization: { name: 'Test business', timezone: 'America/Toronto', currency: 'CAD', capabilities: ['organization.manage'], role: 'Owner' },
}));
vi.mock('@/lib/route/organization', () => ({ requireOrganization: vi.fn(async () => ({ db: {}, ...context })) }));
vi.mock('@/lib/domain/tenancy/identity', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/domain/tenancy/identity')>(),
  getOrganizationIdentity: vi.fn(async () => EMPTY_IDENTITY),
}));
vi.mock('@/app/organizations/[organizationId]/settings/actions', () => ({ updateOrganizationGeneralAction: vi.fn(async () => ({ error: null })) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/organizations/org/settings/general', redirect: (target: string) => { throw new Error(`REDIRECT:${target}`); } }));
vi.mock('@/components/headers/page-header', () => ({ PageHeader: ({ title, meta }: { title: string; meta?: string }) => <header><h1>{title}</h1>{meta}</header> }));
vi.mock('@/lib/route/workspace-configuration', () => ({
  requireWorkspaceConfiguration: vi.fn(async (organizationId: string, workspace: WorkspaceKey) => {
    const gate = { enabledModules: new Set(['reception']), featureAvailability: new Set(AREAS.flatMap(area => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES) };
    return { gate, sections: workspaceConfigureItems(organizationId, workspace, gate).slice(0, only.count ?? undefined) };
  }),
}));
const only: { count?: number } = {};
afterEach(() => { cleanup(); only.count = undefined; });

describe('General is one continuous form', () => {
  it('renders ordinary headings and all field groups without section navigation or repeated organization metadata', async () => {
    render(await GeneralPage({ params: Promise.resolve({ organizationId: 'org' }) } as Parameters<typeof GeneralPage>[0]));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
    expect(screen.queryByText('Test business')).not.toBeInTheDocument();
    for (const name of ['Business identity', 'Primary business address', 'Business contact']) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    for (const name of ['Business name', 'Legal name', 'Industry', 'Country', 'City', 'Postal code', 'Street address', 'Unit or suite', 'Email', 'Phone', 'Website']) expect(screen.getByLabelText(name, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByText(/This address is private/)).toBeVisible();
  });
  it('draws each group as its own shared surface inside one form, so one save persists all of them', async () => {
    const { container } = render(await GeneralPage({ params: Promise.resolve({ organizationId: 'org' }) } as Parameters<typeof GeneralPage>[0]));
    const forms = container.querySelectorAll('form');
    expect(forms).toHaveLength(1);
    const cards = forms[0].querySelectorAll('[data-slot="card"]');
    expect(cards).toHaveLength(3);
    expect([...cards].map(card => card.getAttribute('aria-labelledby'))).toEqual(['identity-heading', 'address-heading', 'contact-heading']);
    expect(forms[0].querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });
  it('preserves the permission state without offering an editable form', async () => {
    const saved = context.organization.capabilities;
    context.organization.capabilities = [];
    try {
      render(await GeneralPage({ params: Promise.resolve({ organizationId: 'org' }) } as Parameters<typeof GeneralPage>[0]));
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
      expect(screen.getByText(/cannot change the business profile/)).toBeVisible();
    } finally { context.organization.capabilities = saved; }
  });
});


describe('CRM configuration pages', () => {
  it('renders its children without a second navigation column', async () => {
    render(await ConfigurationLayout({ params: Promise.resolve({ organizationId: 'org' }), children: <h1>Relationship stages</h1> }));
    expect(screen.getByRole('heading', { name: 'Relationship stages' })).toBeVisible();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

// Batch A: no workspace has a Configuration landing. Each old address resolves to an eligible door.
describe('Retired configuration landings', () => {
  const LANDINGS = {
    sales: () => import('@/app/organizations/[organizationId]/sales/configuration/page'),
    comms: () => import('@/app/organizations/[organizationId]/comms/configuration/page'),
    support: () => import('@/app/organizations/[organizationId]/support/configuration/page'),
    field: () => import('@/app/organizations/[organizationId]/field/configuration/page'),
    finance: () => import('@/app/organizations/[organizationId]/finance/configuration/page'),
    studio: () => import('@/app/organizations/[organizationId]/studio/configuration/page'),
    ai: () => import('@/app/organizations/[organizationId]/ai/configuration/page'),
  };
  const redirectOf = async (segment: keyof typeof LANDINGS) => {
    const { default: Page } = await LANDINGS[segment]();
    try { await Page({ params: Promise.resolve({ organizationId: 'org' }) } as never); } catch (error) { return (error as Error).message; }
    return 'rendered';
  };
  it.each([
    ['sales', 'sales/configuration/relationship-stages'],
    ['comms', 'comms/configuration/calling'],
    ['support', 'support/configuration/queues'],
    ['field', 'work/configuration'],
    ['finance', 'finance/configuration/pricing'],
    ['studio', 'settings/branding'],
    ['ai', 'ai/agents'],
  ] as const)('sends the old %s/configuration address to the first page the member may open and never renders a list', async (segment, path) => {
    expect(await redirectOf(segment)).toBe(`REDIRECT:/organizations/org/${path}`);
  });
  it('goes straight to the only destination', async () => {
    only.count = 1;
    expect(await redirectOf('support')).toBe('REDIRECT:/organizations/org/support/configuration/queues');
  });
});
