import {ContactAffiliations} from '@/features/crm/customers/contact-affiliations';
import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { CustomerDetail } from '@/features/crm/customers/customer-detail';
import { CustomerOpportunities } from '@/features/crm/opportunities/customer-opportunities';
import { listOpportunities, listOpportunityStages } from '@/lib/domain/opportunities/opportunities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listCustomerInvoices, listInvoicesForProposals } from '@/lib/domain/billing/invoices';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listCommercialProposals } from '@/lib/domain/customers/commercial-proposals';
import { recommendConfiguration } from '@/lib/domain/customers/configuration-recommendation';
import { getContact } from '@/lib/domain/contacts/contacts';
import { getDiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import { listProposalInvites } from '@/lib/domain/customers/proposal-invites';
import { getProposalHandoff, type AcceptedProposalHandoff } from '@/lib/domain/customers/proposal-handoff';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocationsForCustomer } from '@/lib/domain/locations/locations';
import { mapConfig } from '@/lib/adapters/maps/config';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { listPortalInvites } from '@/lib/domain/portal/portal';
import { portalOrigin } from '@/lib/domain/portal/address';
import { listCustomerCalls } from '@/lib/domain/reception/calls';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { requestOrigin } from '@/lib/route/origin';
import { followUpsAvailable, relatedFollowUps } from '@/lib/application/crm/follow-ups';
import { RelatedFollowUps } from '@/features/crm/follow-ups/related-follow-ups';
import { ClientTenantSection } from '@/features/crm/customers/client-tenant-section';
import { getClientTenantRelationships, listExistingTenantOptions } from '@/lib/domain/customers/client-tenants';
import { ServiceEngagementSection } from '@/features/crm/customers/service-engagement-section';
import { listServiceEngagements } from '@/lib/domain/customers/service-engagements';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/crm/contacts/[contactId]'>) {
  const { organizationId, contactId: customerId } = await params;
  const raw = await searchParams;
  const one = (key: string) => (typeof raw[key] === 'string' ? raw[key] as string : undefined);
  const { db, organization } = await requireOrganization(organizationId);
  const customer = await getContact(db, { organizationId, customerId });
  if (!customer) notFound();
  // Discovery and configuration describe a GildOps tenant being set up, so they stay with the
  // platform's own organization. A commercial proposal is any business selling from its catalog.
  const mayPropose = (await loadPlatformContext(db, organizationId)) !== null;

  const origin = await requestOrigin();
  const customerPortalOrigin = await portalOrigin(db, organizationId, origin);
  const [opportunities, opportunityStages, members] = await Promise.all([listOpportunities(db, { organizationId, customerId, limit: 20 }), listOpportunityStages(db, { organizationId }), listMembers(db, { organizationId })]);
  const [documents, definitions, timeline, invites, resolvedFeatures, stages, calls, invoices, work, locations, discoverySnapshot, commercialProposals, proposalInvites] = await Promise.all([
    listDocuments(db, { organizationId, attachedTo: { entity: 'customer', id: customerId } }),
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    listCustomerTimeline(db, { organizationId, customerId }),
    listPortalInvites(db, { organizationId, customerId }),
    organizationResolvedFeatureStates(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomerCalls(db, { organizationId, customerId }),
    listCustomerInvoices(db, { organizationId, customerId }),
    listWorkItems(db, { organizationId, customerId }),
    listLocationsForCustomer(db, { organizationId, customerId }),
    mayPropose ? getDiscoverySnapshot(db, { organizationId, customerId }) : null,
    listCommercialProposals(db, { organizationId, customerId }),
    listProposalInvites(db, { organizationId, customerId }),
  ]);
  const configurationRecommendation = mayPropose ? await recommendConfiguration(db, {
    answers: discoverySnapshot?.answers ?? {},
  }) : null;
  const modules = activeModuleKeys(resolvedFeatures);
  const mayPriceManage = organization.capabilities.includes('price.manage');
  const catalogItems = modules.has('billing') && mayPriceManage ? await listPriceBookItems(db, { organizationId }) : [];
  const followUpsEnabled = await followUpsAvailable(db, organizationId);
  const followUps = followUpsEnabled ? await relatedFollowUps(db, organizationId, customerId) : null;
  const voice = modules.has('reception');

  const mayHandoff = await isPlatformStaff(db);
  const [relationships, engagements] = await Promise.all([getClientTenantRelationships(db, organizationId, customerId), listServiceEngagements(db, organizationId, customerId)]);
  const mayManageServices = organization.capabilities.includes('customer.update');
  const tenantOptions = mayHandoff && mayManageServices ? await listExistingTenantOptions(db, organizationId, customerId) : [];
  const mayLink = mayHandoff && mayManageServices && tenantOptions.length > 0;
  // Only a Platform Plan proposal can have been handed off (`hand_off_accepted_proposal`).
  const acceptedProposals = commercialProposals.filter((proposal) => proposal.status === 'accepted' && proposal.basis === 'platform_plan');
  const handoffEntries = await Promise.all(
    acceptedProposals.map(async (proposal) => [
      proposal.id,
      await getProposalHandoff(db, { organizationId, proposalId: proposal.id }),
    ] as const),
  );
  const handoffsByProposalId: Record<string, AcceptedProposalHandoff> = {};
  for (const [proposalId, handoff] of handoffEntries) {
    if (handoff) handoffsByProposalId[proposalId] = handoff;
  }
  // An accepted catalog proposal is invoiced at most once (`invoices_org_proposal_unique`).
  const invoicesByProposalId = await listInvoicesForProposals(db, {
    organizationId,
    proposalIds: commercialProposals.filter((proposal) => proposal.status === 'accepted' && proposal.basis === 'catalog').map((proposal) => proposal.id),
  });
  const invoicing = modules.has('billing') && organization.capabilities.includes('invoice.issue')
    ? { today: todayInZone(organization.timezone), customerName: customer.name }
    : null;

  return (
    <AppPage>
      <CustomerDetail
        organizationId={organizationId}
        query={{ section: one('section'), view: one('view'), tab: one('tab'), classify: one('classify') }}
        opportunityCount={opportunities.total}
        openTaskCount={followUps?.open.length}
        customer={customer}
        affiliations={<ContactAffiliations db={db} organizationId={organizationId} contact={customer} mayEdit={organization.capabilities.includes('customer.update')}/>}
        accessibleTenantIds={relationships.filter(r => r.may_open).map(r => r.tenant_organization_id)}
        services={<div className="mb-6 space-y-6"><ClientTenantSection organizationId={organizationId} customerId={customerId} timezone={organization.timezone} relationships={relationships} tenants={tenantOptions} mayManage={mayManageServices} mayLink={mayLink}/><ServiceEngagementSection organizationId={organizationId} customerId={customerId} relationships={relationships} items={engagements.items} total={engagements.total} mayManage={mayManageServices} opportunities={opportunities} proposals={commercialProposals} work={work}/></div>}
        support={<RelatedSupport organizationId={organizationId} kind="customer" recordId={customerId} customerName={customer.name}/>}
        followUps={followUps ? <RelatedFollowUps organizationId={organizationId} timezone={organization.timezone} members={members} mayManage={organization.capabilities.includes('follow_up.manage')} customer={customer} {...followUps}/> : undefined}
        opportunities={<CustomerOpportunities organizationId={organizationId} customer={customer} items={opportunities} total={opportunities.total} stages={opportunityStages} members={members} defaultCurrency={organization.currency ?? ''} mayCreate={organization.capabilities.includes('opportunity.create')} />}
        stage={voice ? stages.find((entry) => entry.id === customer.stageId) ?? null : null}
        stages={stages}
        definitions={definitions}
        documents={documents}
        timeline={timeline}
        work={work}
        locations={locations}
        mapStyleUrl={mapConfig()?.styleUrl ?? null}
        calls={calls}
        invoices={invoices}
        invites={invites}
        discoverySnapshot={discoverySnapshot}
        mayPropose={mayPropose}
        configurationRecommendation={configurationRecommendation}
        commercialProposals={commercialProposals}
        proposalInvites={proposalInvites}
        handoffsByProposalId={handoffsByProposalId}
        invoicesByProposalId={invoicesByProposalId}
        proposalInvoicing={invoicing}
        mayHandoff={mayHandoff}
        catalogItems={catalogItems}
        origin={origin}
        portalOrigin={customerPortalOrigin}
        timezone={organization.timezone}
        currency={organization.currency ?? ''}
        role={organization.role}
        features={{ voice, billing: modules.has('billing'), portal: modules.has('portal') }}
        permissions={{
          edit: organization.capabilities.includes('customer.update'),
          call: organization.capabilities.includes('call.place'),
          attach: organization.capabilities.includes('document.create'),
          portal: organization.capabilities.includes('customer.create'),
          priceManage: mayPriceManage,
        }}
      />
    </AppPage>
  );
}
import { RelatedSupport } from '@/features/support/related';
