import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { EmptyState } from '@/components/containers/section';
import { buildPipelineColumns, PipelineBoard } from '@/features/crm/sales/pipeline-board';
import { CustomerStageControl } from '@/features/crm/sales/stage-control';
import { StageSettingsSheet } from '@/features/crm/sales/stage-settings-sheet';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function PipelinePage({ params }: PageProps<'/organizations/[organizationId]/customers/pipeline'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  // The same answer the Customers list uses to offer this view at all — one source, so the two
  // sibling views can never disagree about whether the Pipeline exists.
  const [customers, stages, resolvedFeatures] = await Promise.all([
    listCustomers(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    organizationResolvedFeatureStates(db, { organizationId }),
  ]);
  const reception = activeModuleKeys(resolvedFeatures).has('reception');
  const mayMoveCustomers = organization.capabilities.includes('customer.update');
  const stageById = new Map(customers.map((customer) => [customer.id, customer.stageId]));

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('pipeline')}
        crumbs={workspaceAncestry(organizationId, 'pipeline')}
        description="Where each relationship has got to."
        actions={
          reception ? (
            <StageSettingsSheet organizationId={organizationId} stages={stages} mayConfigure={organization.capabilities.includes('field.manage')} role={organization.role} />
          ) : null
        }
      />


      {!reception ? (
        <EmptyState className="mt-6">Switch Communications/Voice on to name a pipeline for this business.</EmptyState>
      ) : stages.length === 0 ? (
        <EmptyState className="mt-6">No stages named. Use Stages to create the first one.</EmptyState>
      ) : (
        <div className="mt-6">
          <PipelineBoard
            columns={buildPipelineColumns(stages, customers)}
            customerHref={(id) => `/organizations/${organizationId}/customers/${id}`}
            renderStageControl={mayMoveCustomers ? (person) => (
              <CustomerStageControl organizationId={organizationId} customerId={person.id} customerName={person.name} currentStageId={stageById.get(person.id) ?? null} stages={stages} />
            ) : undefined}
          />
        </div>
      )}
    </AppPage>
  );
}
