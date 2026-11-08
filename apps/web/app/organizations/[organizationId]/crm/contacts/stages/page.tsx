import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { EmptyState } from '@/components/surfaces/section';
import { buildPipelineColumns, PipelineBoard } from '@/features/crm/sales/pipeline-board';
import { CustomerStageControl } from '@/features/crm/sales/stage-control';
import { ConfigureLink } from '@/components/controls/configure-link';
import { workspaceConfigureDoors } from '@/features/settings/workspace-configure';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function PipelinePage({ params }: PageProps<'/organizations/[organizationId]/crm/contacts/stages'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  // The same answer the Customers list uses to offer this view at all — one source, so the two
  // sibling views can never disagree about whether the Pipeline exists.
  const [customers, stages, resolvedFeatures, doors] = await Promise.all([
    listContacts(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    organizationResolvedFeatureStates(db, { organizationId }),
    workspaceConfigureDoors(organizationId, 'crm'),
  ]);
  // The one configuration this board depends on, offered only to a member who may open it.
  const stagesDoor = doors.find((door) => door.key === 'sales-stages');
  const reception = activeModuleKeys(resolvedFeatures).has('reception');
  const mayMoveCustomers = organization.capabilities.includes('customer.update');
  const stageById = new Map(customers.map((customer) => [customer.id, customer.stageId]));

  return (
    <AppPage>
      <CollectionHeader
        location={{}}
        actions={
          reception && stagesDoor ? (
            <ConfigureLink href={stagesDoor.href} label={stagesDoor.label} />
          ) : null
        }
      />
      {!reception ? (
        <EmptyState
          title="Relationship pipeline is not available"
          description="Switch Communications/Voice on before this business can name pipeline stages."
        />
      ) : stages.length === 0 ? (
        <EmptyState
          title="No stages named"
          description={stagesDoor
            ? 'Name the stages this business moves customer relationships through in Relationship stages.'
            : 'Someone who manages CRM settings names these stages.'}
          action={stagesDoor ? <ConfigureLink href={stagesDoor.href} label={stagesDoor.label} /> : undefined}
        />
      ) : (
        <PipelineBoard
          columns={buildPipelineColumns(stages, customers)}
          customerHref={(id) => `/organizations/${organizationId}/crm/contacts/${id}`}
          renderStageControl={mayMoveCustomers ? (person) => (
            <CustomerStageControl organizationId={organizationId} customerId={person.id} customerName={person.name} currentStageId={stageById.get(person.id) ?? null} stages={stages} />
          ) : undefined}
        />
      )}
    </AppPage>
  );
}
