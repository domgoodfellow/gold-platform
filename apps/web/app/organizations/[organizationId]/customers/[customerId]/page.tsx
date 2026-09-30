import { notFound } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { CustomerDetail } from '@/features/crm/customers/customer-detail';
import { listCustomerInvoices } from '@/lib/domain/billing/invoices';
import { listPlans } from '@/lib/domain/catalogue/plans';
import { listCommercialProposals } from '@/lib/domain/customers/commercial-proposals';
import { recommendConfiguration } from '@/lib/domain/customers/configuration-recommendation';
import { getCustomer } from '@/lib/domain/customers/customers';
import { getDiscoverySnapshot } from '@/lib/domain/customers/discovery-snapshots';
import { listProposalInvites } from '@/lib/domain/customers/proposal-invites';
import { getProposalHandoff, type AcceptedProposalHandoff } from '@/lib/domain/customers/proposal-handoff';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listPortalInvites } from '@/lib/domain/portal/portal';
import { listCustomerCalls } from '@/lib/domain/reception/calls';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { requestOrigin } from '@/lib/route/origin';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: PageProps<'/organizations/[organizationId]/customers/[customerId]'>) {
  const { organizationId, customerId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const customer = await getCustomer(db, { organizationId, customerId });
  if (!customer) notFound();

  const origin = await requestOrigin();
  const [documents, definitions, timeline, invites, resolvedFeatures, stages, calls, invoices, work, discoverySnapshot, commercialProposals, proposalInvites, plans, addonPlans] = await Promise.all([
    listDocuments(db, { organizationId, attachedTo: { entity: 'customer', id: customerId } }),
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    listCustomerTimeline(db, { organizationId, customerId }),
    listPortalInvites(db, { organizationId, customerId }),
    organizationResolvedFeatureStates(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomerCalls(db, { organizationId, customerId }),
    listCustomerInvoices(db, { organizationId, customerId }),
    listWorkItems(db, { organizationId, customerId }),
    getDiscoverySnapshot(db, { organizationId, customerId }),
    listCommercialProposals(db, { organizationId, customerId }),
    listProposalInvites(db, { organizationId, customerId }),
    listPlans(db, { kind: 'plan' }),
    listPlans(db, { kind: 'addon' }),
  ]);
  const configurationRecommendation = await recommendConfiguration(db, {
    answers: discoverySnapshot?.answers ?? {},
  });
  const modules = activeModuleKeys(resolvedFeatures);
  const voice = modules.has('reception');

  const mayHandoff = await isPlatformStaff(db);
  const acceptedProposals = commercialProposals.filter((proposal) => proposal.status === 'accepted');
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

  return (
    <AppPage>
      <CustomerDetail
        organizationId={organizationId}
        customer={customer}
        stage={voice ? stages.find((entry) => entry.id === customer.stageId) ?? null : null}
        stages={stages}
        definitions={definitions}
        documents={documents}
        timeline={timeline}
        work={work}
        calls={calls}
        invoices={invoices}
        invites={invites}
        discoverySnapshot={discoverySnapshot}
        configurationRecommendation={configurationRecommendation}
        commercialProposals={commercialProposals}
        proposalInvites={proposalInvites}
        handoffsByProposalId={handoffsByProposalId}
        mayHandoff={mayHandoff}
        plans={plans.filter((plan) => plan.saleStatus === 'active')}
        addonPlans={addonPlans.filter((plan) => plan.saleStatus === 'active')}
        origin={origin}
        timezone={organization.timezone}
        currency={organization.currency ?? ''}
        role={organization.role}
        features={{ voice, billing: modules.has('billing'), portal: modules.has('portal') }}
        permissions={{
          edit: organization.capabilities.includes('customer.update'),
          call: organization.capabilities.includes('call.place'),
          attach: organization.capabilities.includes('document.create'),
          portal: organization.capabilities.includes('customer.create'),
          priceManage: organization.capabilities.includes('price.manage'),
        }}
      />
    </AppPage>
  );
}
