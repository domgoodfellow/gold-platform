import { Disclosure } from '@/components/containers/card';
import { DividedList, EmptyState, GroupHeading, SectionHeading } from '@/components/containers/section';
import { Widget, WidgetGrid, WidgetPanel } from '@/components/display/widget';
import { Hint } from '@/components/controls/inputs';
import Link from 'next/link';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listCalls } from '@/lib/domain/reception/calls';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';
import {
  CallingNumberForm,
  CreateOutcomeForm,
  CreateStageForm,
  EditStageForm,
  WrapUpCallForm,
} from './reception-forms';

export const dynamic = 'force-dynamic';

/** How many rows a tile previews before *open it* is the better answer. */
const PREVIEW = 4;

/**
 * The floor's day, and the two lists of words it runs on.
 *
 * **One screen rather than two**, because the module is one thing: what happened on the calls,
 * and the vocabulary those calls are recorded in. A separate settings area for eight words would
 * be a second place to go for something somebody adjusts twice a year.
 *
 * **It opens as a dashboard** (`ui-spec.md` §2b), which is what the module is sold on. What it
 * replaced was a flat list of every call this business had ever made, with the pipeline present
 * only as a column of stage names nobody could see anybody standing in.
 */
export default async function CallsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [calls, outcomes, stages, customers] = await Promise.all([
    listCalls(db, { organizationId }),
    listCallOutcomes(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomers(db, { organizationId }),
  ]);
  const dialsFrom = await callingNumber(db, { organizationId });

  const names = new Map(customers.map((customer) => [customer.id, customer.name]));
  const mayConfigure = organization.capabilities.includes('field.manage');
  // The number is the business itself rather than how it records work, so it follows the
  // capability that governs currency and the clock — decided by the policy, read here only to
  // say so on screen (I12).
  const mayManage = organization.capabilities.includes('organization.manage');
  const mayCall = organization.capabilities.includes('call.place');

  const area = `/organizations/${organizationId}/calls`;
  const customerHref = (id: string) => `/organizations/${organizationId}/customers/${id}`;
  const { widget } = await searchParams;
  const open = Array.isArray(widget) ? widget[0] : widget;

  // This business's today, not the server's (I9) — a floor in Auckland and one in Montréal are
  // on different days for most of the server's.
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const todaysCalls = calls.filter(
    (call) => call.startedAt >= day.startsAt && call.startedAt < day.endsAt,
  );

  // **How calls went, in the business's own words and counted over what is on this screen.**
  // Not a rate and not a comparison: *reached* is a flag a business set on its own outcome, and
  // what a good day looks like is not something the platform knows (ui-spec §2b, §7).
  const perOutcome = new Map<string, number>();
  for (const call of calls) {
    if (call.outcome) perOutcome.set(call.outcome.name, (perOutcome.get(call.outcome.name) ?? 0) + 1);
  }
  const unrecorded = calls.filter((call) => call.outcome === null).length;

  const perStage = new Map<string, { id: string; name: string }[]>();
  for (const customer of customers) {
    // Null is ordinary — a business that has named no stages, or a customer nobody has staged
    // yet. Both are "this business has said nothing", never "something is missing".
    const key = customer.stageId ?? '';
    perStage.set(key, [...(perStage.get(key) ?? []), { id: customer.id, name: customer.name }]);
  }
  const staged = customers.filter((customer) => customer.stageId !== null).length;

  const callList = (
    <DividedList>
      {calls.map((call) => (
        <li key={call.id} className="py-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{names.get(call.customerId) ?? 'A customer'}</span>
            <span className="text-sm text-muted">
              {[
                call.direction === 'inbound' ? 'Inbound' : 'Outbound',
                call.toNumber,
                // The network's own account, rendered as written. A business's word for how it
                // went is the outcome below, and the two are never merged.
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
  );

  /*
    **The pipeline, read as a board.** `customer-forms.tsx` already said this was coming: the
    stage selector lives on the customer's own page because moving a relationship is something
    somebody does while looking at the person, and "a board is a way of reading the same column
    and it can be built later". This is the reading. It is deliberately not draggable — dropping a
    card is a write, and the write already has a home; a second one here would be a second path to
    the same column.

    Scrolls sideways rather than wrapping, because columns that reflow stop reading as a pipeline.
  */
  const board = (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {[
        ...stages.map((stage) => ({ key: stage.id, name: stage.name })),
        // Last, and only when somebody is in it. A business that has staged everybody never sees
        // this column at all.
        ...((perStage.get('') ?? []).length > 0
          ? [{ key: '', name: 'No stage' }]
          : []),
      ].map((column) => {
        const people = perStage.get(column.key) ?? [];
        return (
          <section
            key={column.key || 'unstaged'}
            className="flex w-60 shrink-0 flex-col rounded border border-border"
          >
            <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
              <GroupHeading>{column.name}</GroupHeading>
              <span className="text-sm tabular-nums text-muted">{people.length}</span>
            </div>
            {people.length === 0 ? (
              <EmptyState weight="subtle" className="px-3 py-2">
                Nobody here.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {people.map((person) => (
                  <li key={person.id}>
                    <Link
                      href={customerHref(person.id)}
                      className="block truncate px-3 py-2 text-sm underline-offset-4 hover:underline"
                    >
                      {person.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );

  if (open === 'calls' || open === 'pipeline') {
    return (
      <WidgetPanel
        title={open === 'calls' ? 'Every call' : 'Pipeline'}
        backHref={area}
        backLabel="Calls"
      >
        {open === 'calls' ? (
          calls.length === 0 ? (
            <EmptyState>No calls recorded.</EmptyState>
          ) : (
            callList
          )
        ) : stages.length === 0 ? (
          <EmptyState>No stages named.</EmptyState>
        ) : (
          board
        )}
      </WidgetPanel>
    );
  }

  return (
    <>
      <WidgetGrid className="mt-4">
        <Widget
          title="Calls today"
          value={todaysCalls.length}
          note={`${calls.length} recorded in all`}
          href={calls.length > 0 ? `${area}?widget=calls` : undefined}
        >
          {todaysCalls.length === 0 ? (
            <EmptyState weight="subtle">No calls today.</EmptyState>
          ) : (
            <DividedList className="text-sm">
              {todaysCalls.slice(0, PREVIEW).map((call) => (
                <li key={call.id} className="flex items-baseline gap-2 py-1.5">
                  <Link
                    href={customerHref(call.customerId)}
                    className="min-w-0 truncate underline underline-offset-4"
                  >
                    {names.get(call.customerId) ?? 'A customer'}
                  </Link>
                  <span className="ml-auto shrink-0 text-muted">
                    {call.outcome?.name ?? call.status.replace('_', ' ')}
                  </span>
                </li>
              ))}
            </DividedList>
          )}
        </Widget>

        {/* No headline figure: the tile *is* the breakdown, and a total here would be the count
            already on the tile beside it. */}
        <Widget title="How calls went">
          {perOutcome.size === 0 ? (
            <EmptyState weight="subtle">
              Nothing has been written up yet. A call is recorded as it happens; how it went is a
              word somebody adds afterwards.
            </EmptyState>
          ) : (
            <DividedList className="text-sm">
              {[...perOutcome.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([name, count]) => (
                  <li key={name} className="flex items-baseline gap-2 py-1.5">
                    <span className="min-w-0 truncate">{name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-muted">{count}</span>
                  </li>
                ))}
              {unrecorded > 0 ? (
                <li className="flex items-baseline gap-2 py-1.5 text-muted">
                  <span className="min-w-0 truncate">Not written up</span>
                  <span className="ml-auto shrink-0 tabular-nums">{unrecorded}</span>
                </li>
              ) : null}
            </DividedList>
          )}
        </Widget>

        <Widget
          title="Pipeline"
          value={staged}
          note={
            stages.length === 0
              ? 'No stages named yet'
              : `of ${customers.length} in ${stages.length} ${stages.length === 1 ? 'stage' : 'stages'}`
          }
          href={stages.length > 0 ? `${area}?widget=pipeline` : undefined}
        >
          {stages.length === 0 ? (
            <EmptyState weight="subtle">No stages named.</EmptyState>
          ) : (
            <DividedList className="text-sm">
              {stages.slice(0, PREVIEW).map((stage) => (
                <li key={stage.id} className="flex items-baseline gap-2 py-1.5">
                  <span className="min-w-0 truncate">{stage.name}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted">
                    {(perStage.get(stage.id) ?? []).length}
                  </span>
                </li>
              ))}
            </DividedList>
          )}
        </Widget>
      </WidgetGrid>

      {/*
        The module's `configuredAt` points here, and `navigation.test.ts` reads this file for the
        anchor. Below the tiles on purpose: both lists are words this business owns and adjusts
        twice a year, and neither is seeded — a platform that ships no pipeline may not ship one
        through a default.
      */}
      <section id="setup" className="mt-10 scroll-mt-20">
        <SectionHeading>Set up</SectionHeading>

        {/*
          First in Set up, because it is the one thing here without which the module does
          nothing. A business can name every stage and every outcome it likes and still not be
          able to ring anybody.
        */}
        <div className="mt-4">
          <GroupHeading>The number this business dials from</GroupHeading>
          {mayManage ? (
            <CallingNumberForm organizationId={organizationId} number={dialsFrom} />
          ) : (
            <p className="mt-2 text-sm">
              {dialsFrom ?? 'None set.'}{' '}
              <span className="text-muted">
                Your role, {organization.role}, cannot change it.
              </span>
            </p>
          )}
        </div>

        <div className="mt-6">
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
          <Hint className="mt-6">Your role, {organization.role}, cannot change these words.</Hint>
        )}
      </section>
    </>
  );
}
