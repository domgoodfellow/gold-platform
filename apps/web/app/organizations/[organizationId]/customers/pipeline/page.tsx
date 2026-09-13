import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { Disclosure } from '@/components/containers/card';
import { DividedList, EmptyState, GroupHeading, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { buildPipelineColumns, PipelineBoard } from '@/features/crm/sales/pipeline-board';
import { CustomerStageControl } from '@/features/crm/sales/stage-control';
import { CreateStageForm, EditStageForm } from '@/features/crm/sales/stage-settings';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * The pipeline, as CRM/Sales's own canonical surface.
 *
 * **Moved out of the Calls page**, which the `reception` module's shared history had bundled it
 * into. `constraints.md`'s own reasoning for navigation sections applies to the board itself: a
 * runtime module backing two catalogue Products is not a reason for one of them to own the
 * other's screen. The Calls page still shows a pipeline tile — built from the same
 * `PipelineBoard` component, without a stage control — which is what "Voice may consume a
 * pipeline summary, but must not define the CRM Pipeline implementation" looks like in code.
 *
 * Stage naming (`Set up`, below) moved with it, for the same reason: naming this business's own
 * pipeline is a CRM/Sales configuration question, not a Calls one.
 */
export default async function PipelinePage({
  params,
}: PageProps<'/organizations/[organizationId]/customers/pipeline'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [customers, stages, modules] = await Promise.all([
    listCustomers(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listUsableModules(db, { organizationId }),
  ]);

  const reception = modules.has('reception');
  const mayMoveCustomers = organization.capabilities.includes('customer.update');
  const mayConfigure = organization.capabilities.includes('field.manage');

  const stageById = new Map(customers.map((customer) => [customer.id, customer.stageId]));
  const columns = buildPipelineColumns(stages, customers);
  const customerHref = (id: string) => `/organizations/${organizationId}/customers/${id}`;

  return (
    <AppPage width="wide">
      <Link
        href={`/organizations/${organizationId}/customers`}
        className="text-sm text-muted underline underline-offset-4"
      >
        ← Customers
      </Link>

      <Hint className="mt-4">Where each relationship has got to.</Hint>

      {!reception ? (
        <EmptyState className="mt-6">
          Switch Communications/Voice on to name a pipeline for this business.
        </EmptyState>
      ) : stages.length === 0 ? (
        <EmptyState className="mt-6">No stages named.</EmptyState>
      ) : (
        <div className="mt-6">
          <PipelineBoard
            columns={columns}
            customerHref={customerHref}
            renderStageControl={
              mayMoveCustomers
                ? (person) => (
                    <CustomerStageControl
                      organizationId={organizationId}
                      customerId={person.id}
                      customerName={person.name}
                      currentStageId={stageById.get(person.id) ?? null}
                      stages={stages}
                    />
                  )
                : undefined
            }
          />
        </div>
      )}

      {reception ? (
        <section className="mt-10">
          <SectionHeading>Set up</SectionHeading>

          <div className="mt-4">
            <GroupHeading>Stages a relationship moves through</GroupHeading>
            {stages.length === 0 ? (
              <EmptyState className="mt-2">No stages named.</EmptyState>
            ) : (
              <DividedList className="mt-2">
                {stages.map((stage) => (
                  <li key={stage.id}>
                    {mayConfigure ? (
                      <EditStageForm organizationId={organizationId} stage={stage} />
                    ) : (
                      <div className="py-3">{stage.name}</div>
                    )}
                  </li>
                ))}
              </DividedList>
            )}
          </div>

          {mayConfigure ? (
            <Disclosure summary="Add a stage" defaultOpen={stages.length === 0} className="mt-6">
              <CreateStageForm organizationId={organizationId} />
            </Disclosure>
          ) : (
            <Hint className="mt-6">
              Your role, {organization.role}, cannot change these words.
            </Hint>
          )}
        </section>
      ) : null}
    </AppPage>
  );
}
