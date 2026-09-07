import { Disclosure } from '@/components/containers/card';
import { DividedList, EmptyState, GroupHeading, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listCalls } from '@/lib/domain/reception/calls';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { requireOrganization } from '@/lib/route/organization';
import {
  CreateOutcomeForm,
  CreateStageForm,
  EditStageForm,
  WrapUpCallForm,
} from './reception-forms';

export const dynamic = 'force-dynamic';

/**
 * The floor's day, and the two lists of words it runs on.
 *
 * **One screen rather than two**, because the module is one thing: what happened on the calls,
 * and the vocabulary those calls are recorded in. A separate settings area for eight words would
 * be a second place to go for something somebody adjusts twice a year.
 */
export default async function CallsPage({
  params,
}: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [calls, outcomes, stages, customers] = await Promise.all([
    listCalls(db, { organizationId }),
    listCallOutcomes(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomers(db, { organizationId }),
  ]);

  const names = new Map(customers.map((customer) => [customer.id, customer.name]));
  const mayConfigure = organization.capabilities.includes('field.manage');
  const mayCall = organization.capabilities.includes('call.place');

  return (
    <>
      <section className="mt-6">
        <SectionHeading>Recent calls</SectionHeading>

        {calls.length === 0 ? (
          <EmptyState className="mt-2">No calls recorded.</EmptyState>
        ) : (
          <DividedList className="mt-2">
            {calls.map((call) => (
              <li key={call.id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">
                    {names.get(call.customerId) ?? 'A customer'}
                  </span>
                  <span className="text-sm text-muted">
                    {[
                      call.direction === 'inbound' ? 'Inbound' : 'Outbound',
                      call.toNumber,
                      // The network's own account, rendered as written. A business's word for
                      // how it went is the outcome below, and the two are never merged.
                      call.status.replace('_', ' '),
                      call.durationSeconds === null ? null : `${call.durationSeconds}s`,
                      call.outcome?.name ?? null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>

                {call.note ? <p className="mt-1 text-sm">{call.note}</p> : null}

                {mayCall ? (
                  <WrapUpCallForm
                    organizationId={organizationId}
                    callId={call.id}
                    outcomes={outcomes}
                    note={call.note}
                    outcomeId={call.outcome?.id ?? null}
                  />
                ) : null}
              </li>
            ))}
          </DividedList>
        )}
      </section>

      {/*
        The module's `configuredAt` points here. Both lists are words this business owns, and
        neither is seeded — a platform that ships no pipeline may not ship one through a default.
      */}
      <section id="setup" className="mt-10">
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

        <div className="mt-6">
          <GroupHeading>Ways a call can go</GroupHeading>
          {outcomes.length === 0 ? (
            <EmptyState className="mt-2">No outcomes named.</EmptyState>
          ) : (
            <DividedList className="mt-2">
              {outcomes.map((outcome) => (
                <li key={outcome.id} className="py-3">
                  <span>{outcome.name}</span>
                  {outcome.reached ? (
                    <span className="ml-2 text-sm text-muted">counts as reached</span>
                  ) : null}
                </li>
              ))}
            </DividedList>
          )}
        </div>

        {/*
          Hiding the forms is a courtesy, not the guard: `customer_stages_insert` and
          `call_outcomes_insert` both require field.manage in the database, so a caller who
          reaches the action anyway is refused there (I12).
        */}
        {mayConfigure ? (
          <>
            <Disclosure summary="Add a stage" defaultOpen={stages.length === 0} className="mt-6">
              <CreateStageForm organizationId={organizationId} />
            </Disclosure>
            <Disclosure
              summary="Add an outcome"
              defaultOpen={outcomes.length === 0}
              className="mt-3"
            >
              <CreateOutcomeForm organizationId={organizationId} />
            </Disclosure>
          </>
        ) : (
          <Hint className="mt-6">
            Your role, {organization.role}, cannot change these words.
          </Hint>
        )}
      </section>
    </>
  );
}
