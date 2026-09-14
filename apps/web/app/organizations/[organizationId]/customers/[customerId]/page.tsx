import { notFound } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { CustomerDetail } from '@/features/crm/customers/customer-detail';
import { listCustomerInvoices } from '@/lib/domain/billing/invoices';
import { getCustomer } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
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
  const [documents, definitions, timeline, invites, resolvedFeatures, stages, calls, invoices, work] = await Promise.all([
    listDocuments(db, { organizationId, attachedTo: { entity: 'customer', id: customerId } }),
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
    listCustomerTimeline(db, { organizationId, customerId }),
    listPortalInvites(db, { organizationId, customerId }),
    organizationResolvedFeatureStates(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomerCalls(db, { organizationId, customerId }),
    listCustomerInvoices(db, { organizationId, customerId }),
    listWorkItems(db, { organizationId, customerId }),
  ]);
  const modules = activeModuleKeys(resolvedFeatures);
  const voice = modules.has('reception');

  return (
    <AppPage width="wide">
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
        origin={origin}
        timezone={organization.timezone}
        role={organization.role}
        features={{ voice, billing: modules.has('billing'), portal: modules.has('portal') }}
        permissions={{
          edit: organization.capabilities.includes('customer.update'),
          call: organization.capabilities.includes('call.place'),
          attach: organization.capabilities.includes('document.create'),
          portal: organization.capabilities.includes('customer.create'),
        }}
      />
    </AppPage>
  );
}
