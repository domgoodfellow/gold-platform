// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfigurationPage from '@/app/organizations/[organizationId]/sales/configuration/page';
import ConfigurationLayout from '@/app/organizations/[organizationId]/sales/configuration/layout';
import { workspaceConfigureItems, AREAS } from '@/lib/navigation';
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
vi.mock('next/navigation', () => ({ usePathname: () => '/organizations/org/settings/general' }));
vi.mock('@/components/headers/page-header', () => ({ PageHeader: ({ title, meta }: { title: string; meta?: string }) => <header><h1>{title}</h1>{meta}</header> }));
vi.mock('@/lib/route/workspace-configuration', () => ({
  requireWorkspaceConfiguration: vi.fn(async (organizationId: string) => {
    const gate = { enabledModules: new Set(['reception']), featureAvailability: new Set(AREAS.flatMap(area => area.featureKeys ?? [])), capabilities: new Set(ALL_CAPABILITIES) };
    return { gate, sections: workspaceConfigureItems(organizationId, 'crm', gate) };
  }),
}));
afterEach(cleanup);

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
  it('renders a real landing page from the canonical eligible destinations', async () => {
    render(await ConfigurationPage({ params: Promise.resolve({ organizationId: 'org' }) } as Parameters<typeof ConfigurationPage>[0]));
    expect(screen.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    for (const [label, path] of [['Relationship stages', 'relationship-stages'], ['Opportunity stages', 'opportunity-stages'], ['Customer fields', 'fields']]) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', `/organizations/org/sales/configuration/${path}`);
    }
  });
});
