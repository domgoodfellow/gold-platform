import { Disclosure } from '@/components/containers/card';
import { DividedList, EmptyState, GroupHeading, SectionHeading } from '@/components/containers/section';
import { Widget, WidgetGrid, WidgetPanel } from '@/components/display/widget';
import { Hint } from '@/components/controls/inputs';
import Link from 'next/link';
import { CallHistory } from '@/features/communications/voice/call-history';
import { CreateOutcomeForm } from '@/features/communications/voice/outcome-settings';
import { OutboundIdentity } from '@/features/communications/voice/outbound-identity';
import { WrapUpCallForm } from '@/features/communications/voice/wrap-up-form';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listCalls } from '@/lib/domain/reception/calls';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** How many rows a tile previews before *open it* is the better answer. */
const PREVIEW = 4;

/**
 * The floor's day, and the vocabulary its calls are recorded in.
 *
 * **The pipeline board itself moved to `customers/pipeline`**, CRM/Sales's own canonical
 * surface — this page keeps only a summary tile, built from the same customers and stages this
 * page already reads, consistent with `constraints.md`'s rule that Voice may consume a pipeline
 * summary but must not define the implementation. Stage naming moved with it.
 *
 * **It opens as a dashboard** (`ui-spec.md` §2b), which is what the module is sold on.
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
  const pipelineHref = `/organizations/${organizationId}/customers/pipeline`;
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

  const perStageCount = new Map<string, number>();
  for (const customer of customers) {
    if (customer.stageId) perStageCount.set(customer.stageId, (perStageCount.get(customer.stageId) ?? 0) + 1);
  }
  const staged = customers.filter((customer) => customer.stageId !== null).length;

  if (open === 'calls') {
    return (
      <WidgetPanel title="Every call" backHref={area} backLabel="Calls">
        <CallHistory
          calls={calls}
          customerNames={names}
          renderWrapUp={
            mayCall
              ? (call) => (
                  <WrapUpCallForm
                    organizationId={organizationId}
                    callId={call.id}
                    outcomes={outcomes}
                    note={call.note}
                    outcomeId={call.outcome?.id ?? null}
                  />
                )
              : undefined
          }
        />
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
                    href={`/organizations/${organizationId}/customers/${call.customerId}`}
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

        {/* A summary of CRM/Sales's own board, not a second one — see `customers/pipeline`. */}
        <Widget
          title="Pipeline"
          value={staged}
          note={
            stages.length === 0
              ? 'No stages named yet'
              : `of ${customers.length} in ${stages.length} ${stages.length === 1 ? 'stage' : 'stages'}`
          }
          href={stages.length > 0 ? pipelineHref : undefined}
        >
          {stages.length === 0 ? (
            <EmptyState weight="subtle">No stages named.</EmptyState>
          ) : (
            <DividedList className="text-sm">
              {stages.slice(0, PREVIEW).map((stage) => (
                <li key={stage.id} className="flex items-baseline gap-2 py-1.5">
                  <span className="min-w-0 truncate">{stage.name}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted">
                    {perStageCount.get(stage.id) ?? 0}
                  </span>
                </li>
              ))}
            </DividedList>
          )}
        </Widget>
      </WidgetGrid>

      {/*
        The module's `configuredAt` points here, and `navigation.test.ts` reads this file for the
        anchor. Below the tiles on purpose: this list is words this business owns and adjusts
        twice a year, and it is not seeded — a platform that ships no dialer script may not ship
        one through a default.
      */}
      <section id="setup" className="mt-10 scroll-mt-20">
        <SectionHeading>Set up</SectionHeading>

        {/*
          First in Set up, because it is the one thing here without which the module does
          nothing. A business can name every outcome it likes and still not be able to ring
          anybody.
        */}
        <div className="mt-4">
          <GroupHeading>The number this business dials from</GroupHeading>
          {mayManage ? (
            <OutboundIdentity organizationId={organizationId} number={dialsFrom} />
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
          Hiding the form is a courtesy, not the guard: `call_outcomes_insert` requires
          field.manage in the database, so a caller who reaches the action anyway is refused
          there (I12).
        */}
        {mayConfigure ? (
          <Disclosure
            summary="Add an outcome"
            defaultOpen={outcomes.length === 0}
            className="mt-6"
          >
            <CreateOutcomeForm organizationId={organizationId} />
          </Disclosure>
        ) : (
          <Hint className="mt-6">Your role, {organization.role}, cannot change these words.</Hint>
        )}

        <Hint className="mt-6">
          Naming this business&apos;s pipeline stages happens on the{' '}
          <Link href={pipelineHref} className="underline underline-offset-4">
            Pipeline
          </Link>{' '}
          page.
        </Hint>
      </section>
    </>
  );
}
