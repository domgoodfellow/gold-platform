import { ButtonLink } from '@/components/controls/button';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { CallFilters, callFilterFromParams, callsHref, parseCallParams } from '@/features/communications/voice/call-filters';
import { CallHistory } from '@/features/communications/voice/call-history';
import { CallHistoryDisclosure } from '@/features/communications/voice/call-history-disclosure';
import { DialerRecentCalls, DialerWrapUp } from '@/features/communications/voice/dialer-context';
import { VoiceCounters } from '@/features/communications/voice/voice-overview';
import { workspaceConfigureDoors } from '@/features/settings/workspace-configure';
import { ConfigureMenu } from '@/components/controls/configure-menu';
import { WrapUpCallSheet } from '@/features/communications/voice/wrap-up-sheet';
import { getCallCounts, listCallPage } from '@/lib/domain/reception/calls';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { listMembers } from '@/lib/domain/tenancy/members';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

import { loadCallingOptions } from '@/lib/application/communications/calling-options';
import { loadDialerQueue } from '@/lib/application/communications/dialer-queue';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';
import { DialerWorkspace } from '@/features/communications/voice/dialer-workspace';
import { callListAvailable } from '@/lib/application/communications/call-list';

export const dynamic = 'force-dynamic';

/** Calls waiting for an outcome shown in the Dialer's Wrap-up tab before it points at the history. */
const WRAP_UP_PREVIEW = 3;

export default async function CallsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'calls');
  const query = await searchParams;
  const { params: callParams, cursor } = parseCallParams(query);
  const prefill = typeof query.to === 'string' && /^\+[1-9][0-9]{7,14}$/.test(query.to) ? query.to : '';
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const mayCall = organization.capabilities.includes('call.place');
  const mayAddToList = await callListAvailable(db, organization);
  const base = `/organizations/${organizationId}/calls`;

  const [page, counts, todays, outcomes, numbers, members, options, queueAvailable, doors, toWrapUp] = await Promise.all([
    listCallPage(db, { organizationId, filter: callFilterFromParams(callParams, organization.timezone), cursor }),
    getCallCounts(db, { organizationId, dayStart: day.startsAt, dayEnd: day.endsAt }),
    listCallPage(db, { organizationId, filter: { since: day.startsAt, until: day.endsAt }, limit: 100 }),
    listCallOutcomes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    listMembers(db, { organizationId }),
    loadCallingOptions(db, { organizationId, mayCall }),
    followUpsAvailable(db, organizationId),
    workspaceConfigureDoors(organizationId, 'communications'),
    mayCall ? listCallPage(db, { organizationId, filter: { needsWrapUp: true }, limit: WRAP_UP_PREVIEW }) : null,
  ]);

  const numberById = new Map(numbers.map((entry) => [entry.id, { e164: entry.e164, label: entry.label }]));
  const queue = queueAvailable ? await loadDialerQueue(db, organizationId) : { items: [], total: 0 };
  const filtered = Object.keys(callParams).length > 0;
  const setupHref = options.blocker?.setup ? doors.find((door) => door.key === options.blocker?.setup)?.href ?? null : null;
  const recentCalls = Object.fromEntries(queue.items.flatMap(({ customer, recentCalls: calls }) => customer
    ? [[customer.id, <DialerRecentCalls key={customer.id} organizationId={organizationId} timeZone={organization.timezone} calls={calls} />]]
    : []));

  return (
    <AppPage>
      <PageHeader title={areaLabel('calls')} crumbs={workspaceAncestry(organizationId, 'calls')} className="mb-0" />
      <DialerWorkspace
        organizationId={organizationId}
        timezone={organization.timezone}
        queue={queue.items}
        queueTotal={queue.total}
        queueAvailable={queueAvailable}
        options={options}
        prefill={prefill}
        setupHref={setupHref}
        recentCalls={recentCalls}
        mayAddToList={mayAddToList}
        actions={
          <>
            <ButtonLink href="#call-history" tone="secondary">Call history</ButtonLink>
            {/* The Dialer configures calling, not the whole of Communications. */}
            <ConfigureMenu label="Calling settings" items={doors.filter((door) => door.key === 'call-setup' || door.key === 'phone-numbers')} />
          </>
        }
        wrapUp={toWrapUp && counts.needsWrapUp > 0 ? <DialerWrapUp organizationId={organizationId} timeZone={organization.timezone} calls={toWrapUp.items} total={counts.needsWrapUp} outcomes={outcomes} href={`${callsHref(base, { wrap: '1' })}#call-history`} /> : undefined}
      />
      {/* Rendered by the page, not the console: Focus hides it with the console's presentation state. */}
      <div className="mt-4 peer-data-[presentation=focus]:hidden">
        <CallHistoryDisclosure open={filtered || !!cursor} summary={<h2 id="call-history-heading" className="text-sm font-semibold tracking-tight">Call history</h2>}>
          <VoiceCounters organizationId={organizationId} counts={counts} todaysCalls={todays.items} />
          <div className="mt-4"><CallFilters
            base={base}
            params={callParams}
            numbers={numbers.map((entry) => ({ id: entry.id, e164: entry.e164, label: entry.label }))}
            members={members.map((member) => ({ id: member.id, displayName: member.displayName }))}
          /></div>
          <div className="mt-4">
            <CallHistory
              organizationId={organizationId}
              timeZone={organization.timezone}
              calls={page.items}
              numbers={numberById}
              empty={filtered ? 'No calls match these filters.' : 'No calls yet. They appear here as they are made and taken.'}
              renderWrapUp={mayCall ? (call) => (call.status === 'completed' ? <WrapUpCallSheet organizationId={organizationId} call={call} outcomes={outcomes} /> : null) : undefined}
            />
          </div>
          <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label="Pages of calls">
            {cursor ? <ButtonLink href={`${callsHref(base, callParams)}#call-history`} scroll={false} tone="secondary" size="small">Newest calls</ButtonLink> : null}
            {page.nextCursor ? <ButtonLink href={`${callsHref(base, callParams, page.nextCursor)}#call-history`} scroll={false} tone="secondary" size="small">Older calls</ButtonLink> : null}
          </nav>
        </CallHistoryDisclosure>
      </div>
    </AppPage>
  );
}
