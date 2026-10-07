// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { counted } from '@/lib/domain/counted';
import type { Customer } from '@/lib/domain/customers/customers';
import { CrmHome, type CrmHomeProps } from '@/features/crm/home/crm-home';
import SalesPage from '@/app/organizations/[organizationId]/sales/page';

const state = vi.hoisted(() => ({
  modules: new Set<string>(), features: new Set<string>(), capabilities: [] as string[],
  total: 0, unstaged: 0, stageCount: 0,
  stages: [] as { id: string; name: string; position: number }[],
  list: vi.fn(), activity: vi.fn(), insights: vi.fn(),
}));
vi.mock('@/lib/route/organization', () => ({ requireOrganization: async () => ({ db: {}, organization: { capabilities: state.capabilities, timezone: 'America/Toronto', role: 'Member' } }) }));
vi.mock('@/lib/domain/catalogue/organization-plans', () => ({
  organizationResolvedFeatureStates: async () => [], activeModuleKeys: () => state.modules, availableFeatureKeys: () => state.features,
}));
vi.mock('@/lib/domain/customers/customers', () => ({ listCustomers: (...args: unknown[]) => state.list(...args) }));
vi.mock('@/lib/domain/customers/stages', () => ({ listCustomerStages: async () => state.stages }));
vi.mock('@/lib/domain/fields/field-definitions', () => ({ listFieldDefinitions: async () => [] }));
vi.mock('@/features/timeline/workspace-activity', () => ({ WorkspaceActivity: (props: unknown) => { state.activity(props); return <p>No CRM activity yet.</p>; } }));
vi.mock('@/features/insights/workspace-insights', () => ({ CustomersInsights: (props: unknown) => { state.insights(props); return <p>Canonical insights</p>; } }));
vi.mock('@/features/crm/customers/customer-configuration', () => ({ CustomerConfiguration: () => <p>Canonical configuration</p> }));
vi.mock('@/features/crm/customers/create-customer-sheet', () => ({
  CreateCustomerSheetProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CreateCustomerTrigger: () => <button>New customer</button>,
}));
vi.mock('@/components/panels/configure-registrar', () => ({ ConfigureRegistrar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/panels/support-registrar', () => ({ SupportRegistrar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/panels/workspace-right-rail', () => ({ SupportTrigger: ({ mode }: { mode: string }) => <button>{mode}</button> }));

const customer: Customer = { id: 'ada', name: 'Ada & Co', email: 'ada@example.test', phone: null, stageId: 'review', createdAt: '2026-10-07T02:00:00Z', custom: {} };
const defaults: CrmHomeProps = {
  organizationId: 'org', timezone: 'America/Toronto', customers: [], totalCustomers: 0,
  pipeline: null, mayCreate: false, mayImport: false, mayConfigure: false, mayInsight: false,
  activity: <p>No CRM activity yet.</p>,
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.modules = new Set(); state.features = new Set(); state.capabilities = [];
  state.total = 0; state.unstaged = 0; state.stageCount = 0; state.stages = [];
  state.list.mockImplementation(async (_db, input) => counted(input.limit === 5 && state.total ? [customer] : [], input.stageId === null ? state.unstaged : input.stageId ? state.stageCount : state.total));
});
const renderRoute = async () => render(await SalesPage({ params: Promise.resolve({ organizationId: 'org' }) } as Parameters<typeof SalesPage>[0]));

describe('CRM Home', () => {
  it('retains useful empty structure and distinguishes unavailable pipeline from zero', () => {
    render(<CrmHome {...defaults} />);
    expect(screen.getByRole('heading', { name: 'CRM' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Customers\s*0$/ })).toHaveAttribute('href', '/organizations/org/customers');
    expect(screen.getByText(/Pipeline is not available/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /In pipeline/ })).not.toBeInTheDocument();
    expect(screen.getByText('No customers have been added yet.')).toBeInTheDocument();
    expect(screen.getByText('No CRM activity yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View all customers' })).toHaveAttribute('href', '/organizations/org/customers');
  });

  it('offers canonical search URL state without searching planned collections', () => {
    render(<CrmHome {...defaults} />);
    expect(screen.getByRole('search')).toHaveAttribute('action', '/organizations/org/customers');
    expect(screen.getByRole('search')).toHaveAttribute('method', 'get');
    expect(screen.getByRole('searchbox', { name: 'Search customers' })).toHaveAttribute('name', 'q');
    expect(document.body.textContent).not.toMatch(/opportunities|follow-ups|contacts|forecast|conversion|assignee|owner/i);
  });

  it('shows configured zero-count stages in an empty organization', () => {
    render(<CrmHome {...defaults} pipeline={{ unstaged: 0, stages: [{ id: 'review', name: 'Review together', position: 0, count: 0 }] }} />);
    const section = screen.getByRole('region', { name: 'Pipeline snapshot' });
    expect(within(section).getByText('Review together')).toBeInTheDocument();
    expect(within(section).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('No sales stages configured')).not.toBeInTheDocument();
  });

  it('renders exact total/staged/unstaged counts, ordered stages and detail links', async () => {
    state.modules.add('reception'); state.features.add('pipeline');
    state.total = 1205; state.unstaged = 200; state.stageCount = 1005;
    state.stages = [{ id: 'review', name: 'Review together', position: 0 }];
    await renderRoute();
    expect(screen.getByRole('link', { name: /Customers\s*1205$/ })).toHaveAttribute('href', '/organizations/org/customers');
    expect(screen.getByRole('link', { name: /In pipeline\s*1005$/ })).toHaveAttribute('href', '/organizations/org/customers/pipeline');
    expect(screen.getByRole('link', { name: /Unstaged\s*200$/ })).toHaveAttribute('href', '/organizations/org/customers?stage=unstaged');
    expect(screen.getByRole('link', { name: 'View pipeline' })).toHaveAttribute('href', '/organizations/org/customers/pipeline');
    expect(screen.getAllByRole('link', { name: 'Ada & Co' })[0]).toHaveAttribute('href', '/organizations/org/customers/ada');
    expect(screen.getAllByText('6 Oct 2026').length).toBeGreaterThan(0);
    expect(state.list).toHaveBeenCalledWith({}, { organizationId: 'org', limit: 5 });
    expect(state.list).toHaveBeenCalledWith({}, { organizationId: 'org', limit: 1, stageId: 'review' });
    expect(state.activity).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org', scope: 'customers', limit: 5 }));
  });

  it('uses feature availability even when another reception feature keeps the module on', async () => {
    state.modules.add('reception'); state.features.add('call_history');
    await renderRoute();
    expect(screen.getByText(/Pipeline is not available/)).toBeInTheDocument();
    expect(state.list).toHaveBeenCalledTimes(1);
  });

  it('exposes setup, creation, import, configuration and insights only with their actual gates', async () => {
    state.modules = new Set(['reception', 'integrations', 'reporting']);
    state.features = new Set(['pipeline', 'file_imports', 'saved_reports']);
    state.capabilities = ['customer.create', 'field.manage', 'integration.manage', 'report.read'];
    await renderRoute();
    expect(screen.getByText('No sales stages configured')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configure sales stages' })).toHaveAttribute('href', '/organizations/org/settings/sales-stages');
    expect(screen.getAllByRole('button', { name: 'New customer' })).toHaveLength(2);
    expect(screen.getAllByRole('link', { name: 'Import customers' })[0]).toHaveAttribute('href', '/organizations/org/integrations/imports/new');
    expect(screen.getByRole('link', { name: 'Custom field settings' })).toHaveAttribute('href', '/organizations/org/settings/custom-fields');
    expect(state.insights).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org', salesEnabled: true }));
    cleanup(); state.capabilities = [];
    await renderRoute();
    expect(screen.queryByRole('button', { name: 'New customer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import customers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configure sales stages' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'configure' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'insights' })).not.toBeInTheDocument();
  });

  it('hides imports when file imports are inactive despite other integrations being active', async () => {
    state.modules.add('integrations'); state.features.add('app_connections'); state.capabilities = ['integration.manage'];
    await renderRoute();
    expect(screen.queryByRole('link', { name: 'Import customers' })).not.toBeInTheDocument();
  });
});
