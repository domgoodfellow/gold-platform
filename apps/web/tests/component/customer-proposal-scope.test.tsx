// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerPage from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/page';

const boundary = vi.hoisted(() => ({
  operating: true,
  authority: true,
  db: {},
  discovery: vi.fn(),
  proposals: vi.fn(),
  invites: vi.fn(),
  plans: vi.fn(),
  catalog: vi.fn(),
  modules: new Set<string>(),
  capabilities: ['customer.read'] as string[],
  recommendation: vi.fn(),
  handoff: vi.fn(),
}));

vi.mock('@/lib/route/organization', () => ({ requireOrganization: async () => ({ db: boundary.db, organization: { capabilities: boundary.capabilities, timezone: 'America/Toronto', currency: 'CAD', role: 'Owner' } }) }));
vi.mock('@/lib/domain/platform/operating-organization', () => ({ isOperatingOrganization: async () => boundary.operating }));
vi.mock('@/lib/domain/platform/permissions', () => ({ platformPermissions: async () => new Set(boundary.authority ? ['platform.organizations'] : []) }));
vi.mock('@/lib/domain/platform/tenants', () => ({ isPlatformStaff: async () => boundary.authority }));
vi.mock('@/lib/domain/customers/discovery-snapshots', () => ({ getDiscoverySnapshot: boundary.discovery }));
vi.mock('@/lib/domain/customers/commercial-proposals', () => ({ listCommercialProposals: boundary.proposals }));
vi.mock('@/lib/domain/customers/proposal-invites', () => ({ listProposalInvites: boundary.invites }));
vi.mock('@/lib/domain/catalogue/plans', () => ({ listPlans: boundary.plans }));
vi.mock('@/lib/domain/pricing/price-book', () => ({ listPriceBookItems: boundary.catalog }));
vi.mock('@/lib/domain/customers/configuration-recommendation', () => ({ recommendConfiguration: boundary.recommendation }));
vi.mock('@/lib/domain/customers/proposal-handoff', () => ({ getProposalHandoff: boundary.handoff }));
vi.mock('@/lib/domain/contacts/contacts', () => ({ getContact: async () => ({ id: 'customer', name: 'Real customer', custom: {} }) }));
vi.mock('@/lib/route/origin', () => ({ requestOrigin: async () => 'http://localhost' }));
vi.mock('@/lib/domain/portal/address', () => ({ portalOrigin: async () => 'http://localhost' }));
vi.mock('@/lib/domain/opportunities/opportunities', () => ({ listOpportunities: async () => [], listOpportunityStages: async () => [] }));
vi.mock('@/lib/domain/tenancy/members', () => ({ listMembers: async () => [] }));
vi.mock('@/lib/domain/documents/documents', () => ({ listDocuments: async () => [] }));
vi.mock('@/lib/domain/fields/field-definitions', () => ({ listFieldDefinitions: async () => [] }));
vi.mock('@/lib/domain/timeline/timeline', () => ({ listCustomerTimeline: async () => [] }));
vi.mock('@/lib/domain/portal/portal', () => ({ listPortalInvites: async () => [] }));
vi.mock('@/lib/domain/catalogue/organization-plans', () => ({ organizationResolvedFeatureStates: async () => [], activeModuleKeys: () => boundary.modules }));
vi.mock('@/lib/domain/customers/stages', () => ({ listCustomerStages: async () => [] }));
vi.mock('@/lib/domain/reception/calls', () => ({ listCustomerCalls: async () => [] }));
vi.mock('@/lib/domain/billing/invoices', () => ({ listCustomerInvoices: async () => [], listInvoicesForProposals: async () => ({}) }));
vi.mock('@/lib/domain/work-items/work-items', () => ({ listWorkItems: async () => [] }));
vi.mock('@/lib/domain/locations/locations', () => ({ listLocationsForCustomer: async () => [] }));
vi.mock('@/lib/adapters/maps/config', () => ({ mapConfig: () => null }));
vi.mock('@/lib/application/crm/follow-ups', () => ({ followUpsAvailable: async () => false }));
vi.mock('@/lib/domain/customers/client-tenants', () => ({ getClientTenantRelationships: async () => [], listExistingTenantOptions: async () => [] }));
vi.mock('@/lib/domain/customers/service-engagements', () => ({ listServiceEngagements: async () => ({ items: [], total: 0 }) }));

vi.mock('@/app/organizations/[organizationId]/crm/contacts/[contactId]/actions', () => ({ createPortalInviteAction: vi.fn(), revokePortalInviteAction: vi.fn(), uploadCustomerDocumentAction: vi.fn() }));
vi.mock('@/features/crm/customers/contact-affiliations', () => ({ ContactAffiliations: () => null }));
vi.mock('@/features/crm/customers/customer-header', () => ({ CustomerHeader: () => <h1>Customer</h1> }));
vi.mock('@/features/crm/customers/discovery-snapshot-section', () => ({ DiscoverySnapshotSection: () => null }));
vi.mock('@/features/crm/customers/configuration-recommendation-section', () => ({ ConfigurationRecommendationSection: () => null }));
vi.mock('@/features/crm/customers/commercial-proposal-section', () => ({ CommercialProposalSection: () => null }));
vi.mock('@/features/crm/customers/customer-locations-section', () => ({ CustomerLocationsSection: () => null }));
vi.mock('@/features/crm/customers/customer-related-work', () => ({ CustomerRelatedWork: () => null }));
vi.mock('@/features/crm/customers/customer-financial-summary', () => ({ CustomerFinancialSummary: () => null }));
vi.mock('@/features/documents/section', () => ({ DocumentsSection: () => null }));
vi.mock('@/features/portal-access/portal-link-form', () => ({ PortalLinkForm: () => null }));
vi.mock('@/features/portal-access/invite-list', () => ({ PortalInviteList: () => null }));
vi.mock('@/features/crm/opportunities/customer-opportunities', () => ({ CustomerOpportunities: () => null }));
vi.mock('@/features/crm/follow-ups/related-follow-ups', () => ({ RelatedFollowUps: () => null }));
vi.mock('@/features/support/related', () => ({ RelatedSupport: () => null }));
vi.mock('@/features/crm/customers/client-tenant-section', () => ({ ClientTenantSection: () => <span>Client tenants</span> }));
vi.mock('@/features/crm/customers/service-engagement-section', () => ({ ServiceEngagementSection: () => <span>Service engagements</span> }));

async function renderPage(query: Record<string, string> = {}) {
  return render(await CustomerPage({ params: Promise.resolve({ organizationId: 'org', contactId: 'customer' }), searchParams: Promise.resolve(query) } as Parameters<typeof CustomerPage>[0]));
}
// V1.4: proposal work lives under the record's Sales section, and services under Related.
// Discovery and configuration describe a GildOps tenant being set up and stay with platform
// authority in the operating organization. Commercial proposals are any business selling from its
// own catalog (ADR-051): offered wherever the catalog is usable, or wherever there is history.
const PLATFORM_VIEWS = ['Discovery', 'Proposed setup'];
const PROPOSAL_VIEWS = [...PLATFORM_VIEWS, 'Commercial proposals'];

beforeEach(() => {
  vi.clearAllMocks();
  boundary.operating = true;
  boundary.authority = true;
  boundary.modules = new Set();
  boundary.capabilities = ['customer.read'];
  boundary.discovery.mockResolvedValue(null);
  boundary.proposals.mockResolvedValue([{ id: 'accepted-proposal', status: 'accepted', basis: 'platform_plan' }]);
  boundary.catalog.mockResolvedValue([]);
  boundary.invites.mockResolvedValue([]);
  boundary.plans.mockResolvedValue([]);
  boundary.recommendation.mockResolvedValue({ recommended: [], optional: [], notNeeded: [] });
  boundary.handoff.mockResolvedValue(null);
});
afterEach(cleanup);

describe('customer proposal scope', () => {
  it.each([
    { operating: false, authority: false, label: 'a tenant member' },
    { operating: false, authority: true, label: 'platform staff visiting another business' },
    { operating: true, authority: false, label: 'an operating-organization member without platform authority' },
  ])('omits proposal tabs, and every platform and catalogue read, for $label with no catalog or history', async ({ operating, authority }) => {
    boundary.operating = operating;
    boundary.authority = authority;
    boundary.proposals.mockResolvedValue([]);
    const { unmount } = await renderPage({ section: 'sales' });
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    for (const name of PROPOSAL_VIEWS) expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    unmount();
    await renderPage({ section: 'related', view: 'services' });
    for (const read of [boundary.discovery, boundary.plans, boundary.catalog, boundary.recommendation, boundary.handoff]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(screen.getByText('Service engagements')).toBeVisible();
    expect(screen.getByText('Client tenants')).toBeVisible();
  });

  it('loads discovery, configuration and hand-off state only for platform authority in the operating organization', async () => {
    await renderPage({ section: 'sales' });
    for (const name of PROPOSAL_VIEWS) expect(screen.getByRole('link', { name })).toHaveAttribute('href', expect.stringContaining('section=sales&view='));
    expect(boundary.discovery).toHaveBeenCalledOnce();
    expect(boundary.proposals).toHaveBeenCalledOnce();
    expect(boundary.invites).toHaveBeenCalledOnce();
    expect(boundary.recommendation).toHaveBeenCalledOnce();
    expect(boundary.handoff).toHaveBeenCalledWith(boundary.db, { organizationId: 'org', proposalId: 'accepted-proposal' });
    // New versions come from the catalog, so the global Platform Plan list is never loaded.
    expect(boundary.plans).not.toHaveBeenCalled();
  });

  it('offers an ordinary business commercial proposals from its own catalog, with no platform reads', async () => {
    boundary.operating = false;
    boundary.authority = false;
    boundary.modules = new Set(['billing']);
    boundary.capabilities = ['customer.read', 'price.manage'];
    boundary.proposals.mockResolvedValue([{ id: 'accepted-catalog', status: 'accepted', basis: 'catalog' }]);
    await renderPage({ section: 'sales' });
    expect(screen.getByRole('link', { name: 'Commercial proposals' })).toHaveAttribute('href', expect.stringContaining('section=sales&view=commercial'));
    for (const name of PLATFORM_VIEWS) expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    expect(boundary.catalog).toHaveBeenCalledWith(boundary.db, { organizationId: 'org' });
    for (const read of [boundary.discovery, boundary.plans, boundary.recommendation, boundary.handoff]) expect(read).not.toHaveBeenCalled();
  });

  it('keeps a business\'s proposal history readable without its catalog, and offers no catalog to a role without price.manage', async () => {
    boundary.operating = false;
    boundary.authority = false;
    boundary.modules = new Set(['billing']);
    await renderPage({ section: 'sales' });
    expect(screen.getByRole('link', { name: 'Commercial proposals' })).toBeInTheDocument();
    expect(boundary.catalog).not.toHaveBeenCalled();
    cleanup();
    boundary.modules = new Set();
    await renderPage({ section: 'sales' });
    expect(screen.getByRole('link', { name: 'Commercial proposals' })).toBeInTheDocument();
  });

  it('refuses a contact page to a role that may not view contacts, before any read', async () => {
    boundary.capabilities = ['customer.create', 'customer.update'];
    await expect(renderPage()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    for (const read of [boundary.discovery, boundary.proposals, boundary.catalog, boundary.invites]) expect(read).not.toHaveBeenCalled();
  });
});
