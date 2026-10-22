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
  recommendation: vi.fn(),
  handoff: vi.fn(),
}));

vi.mock('@/lib/route/organization', () => ({ requireOrganization: async () => ({ db: boundary.db, organization: { capabilities: [], timezone: 'America/Toronto', currency: 'CAD', role: 'Owner' } }) }));
vi.mock('@/lib/domain/platform/operating-organization', () => ({ isOperatingOrganization: async () => boundary.operating }));
vi.mock('@/lib/domain/platform/permissions', () => ({ platformPermissions: async () => new Set(boundary.authority ? ['platform.organizations'] : []) }));
vi.mock('@/lib/domain/platform/tenants', () => ({ isPlatformStaff: async () => boundary.authority }));
vi.mock('@/lib/domain/customers/discovery-snapshots', () => ({ getDiscoverySnapshot: boundary.discovery }));
vi.mock('@/lib/domain/customers/commercial-proposals', () => ({ listCommercialProposals: boundary.proposals }));
vi.mock('@/lib/domain/customers/proposal-invites', () => ({ listProposalInvites: boundary.invites }));
vi.mock('@/lib/domain/catalogue/plans', () => ({ listPlans: boundary.plans }));
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
vi.mock('@/lib/domain/catalogue/organization-plans', () => ({ organizationResolvedFeatureStates: async () => [], activeModuleKeys: () => new Set() }));
vi.mock('@/lib/domain/customers/stages', () => ({ listCustomerStages: async () => [] }));
vi.mock('@/lib/domain/reception/calls', () => ({ listCustomerCalls: async () => [] }));
vi.mock('@/lib/domain/billing/invoices', () => ({ listCustomerInvoices: async () => [] }));
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

async function renderPage() {
  return render(await CustomerPage({ params: Promise.resolve({ organizationId: 'org', contactId: 'customer' }) } as Parameters<typeof CustomerPage>[0]));
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.operating = true;
  boundary.authority = true;
  boundary.discovery.mockResolvedValue(null);
  boundary.proposals.mockResolvedValue([{ id: 'accepted-proposal', status: 'accepted' }]);
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
  ])('omits proposal tabs and all proposal/catalogue reads for $label', async ({ operating, authority }) => {
    boundary.operating = operating;
    boundary.authority = authority;
    await renderPage();
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    for (const name of ['Discovery', 'Proposed configuration', 'Commercial proposal']) {
      expect(screen.queryByRole('tab', { name })).not.toBeInTheDocument();
    }
    for (const read of [boundary.discovery, boundary.proposals, boundary.invites, boundary.plans, boundary.recommendation, boundary.handoff]) {
      expect(read).not.toHaveBeenCalled();
    }
    expect(screen.getByText('Service engagements')).toBeVisible();
    expect(screen.getByText('Client tenants')).toBeVisible();
  });

  it('loads and renders proposals only for platform authority in the operating organization', async () => {
    await renderPage();
    for (const name of ['Discovery', 'Proposed configuration', 'Commercial proposal']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(boundary.discovery).toHaveBeenCalledOnce();
    expect(boundary.proposals).toHaveBeenCalledOnce();
    expect(boundary.invites).toHaveBeenCalledOnce();
    expect(boundary.plans).toHaveBeenCalledWith(boundary.db, { kind: 'plan' });
    expect(boundary.plans).toHaveBeenCalledWith(boundary.db, { kind: 'addon' });
    expect(boundary.recommendation).toHaveBeenCalledOnce();
    expect(boundary.handoff).toHaveBeenCalledWith(boundary.db, { organizationId: 'org', proposalId: 'accepted-proposal' });
  });
});
