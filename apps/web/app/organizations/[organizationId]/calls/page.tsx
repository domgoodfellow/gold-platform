import { ButtonLink } from '@/components/controls/button';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { CallFilters, callFilterFromParams, callsHref, parseCallParams } from '@/features/communications/voice/call-filters';
import { CallHistory } from '@/features/communications/voice/call-history';
import { CallHistoryDisclosure } from '@/features/communications/voice/call-history-disclosure';
import { DialerWrapUp } from '@/features/communications/voice/dialer-context';
import { VoiceCounters } from '@/features/communications/voice/voice-overview';
import { workspaceConfigureDoors } from '@/features/settings/workspace-configure';
import { WrapUpCallSheet } from '@/features/communications/voice/wrap-up-sheet';
import { getCallCounts, listCallPage } from '@/lib/domain/reception/calls';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { listMembers } from '@/lib/domain/tenancy/members';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

import { callingSetupDoor, loadCallingOptions } from '@/lib/application/communications/calling-options';
import { loadCallList } from '@/lib/application/communications/dialer-queue';
import { followUpsAvailable } from '@/lib/application/crm/follow-ups';
import { DialerWorkspace } from '@/features/communications/voice/dialer-workspace';
import { callListAvailable, callListRemovalAvailable } from '@/lib/application/communications/call-list';
import { DomainError } from '@/lib/domain/errors';

export const dynamic = 'force-dynamic';

/** Calls waiting for an outcome shown under Needs wrap-up in the Dialer before it points at the history. */
const WRAP_UP_PREVIEW = 3;

export default async function CallsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'calls');
  const query = await searchParams;
  const { params: callParams, cursor } = parseCallParams(query);
  const prefill = typeof query.to === 'string' && /^\+[1-9][0-9]{7,14}$/.test(query.to) ? query.to : '';
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const mayCall = organization.capabilities.includes('call.place');
  const mayDialManually = mayCall && organization.capabilities.includes('call.dial_manual');
  const [mayAddToList, mayRemoveFromList] = await Promise.all([callListAvailable(db, organization), callListRemovalAvailable(db, organization)]);
  const base = `/organizations/${organizationId}/calls`;

  const [page, counts, todays, outcomes, numbers, members, options, queueAvailable, doors, toWrapUp] = await Promise.all([
    listCallPage(db, { organizationId, filter: callFilterFromParams(callParams, organization.timezone), cursor }),
    getCallCounts(db, { organizationId, dayStart: day.startsAt, dayEnd: day.endsAt }),
    listCallPage(db, { organizationId, filter: { since: day.startsAt, until: day.endsAt }, limit: 100 }),
    listCallOutcomes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    listMembers(db, { organizationId }),
    loadCallingOptions(db, { organizationId, mayCall, mayDialManually }),
    followUpsAvailable(db, organizationId),
    workspaceConfigureDoors(organizationId, 'communications'),
    mayCall ? listCallPage(db, { organizationId, filter: { needsWrapUp: true }, limit: WRAP_UP_PREVIEW }) : null,
  ]);

  const numberById = new Map(numbers.map((entry) => [entry.id, { e164: entry.e164, label: entry.label }]));
  // The first page of the default view. Any other view, a search or a further page is read by the list itself.
  const noCalls = { items: [], total: 0, counts: { all: 0, mine: 0, due: 0, overdue: 0, upcoming: 0, callbacks: 0 } };
  const queue = queueAvailable ? await loadCallList(db, organizationId).catch((error: unknown) => {
    // A member who may neither place calls nor view contacts is shown no list rather than an error page.
    if (error instanceof DomainError && error.code === 'call_list.forbidden') return noCalls;
    throw error;
  }) : noCalls;
  const filtered = Object.keys(callParams).length > 0;

  return (
    <AppPage>
      <PageHeader title={areaLabel('calls')} crumbs={workspaceAncestry(organizationId, 'calls')} className="mb-0" />
      <DialerWorkspace
        organizationId={organizationId}
        timezone={organization.timezone}
        queue={queue.items}
        queueTotal={queue.total}
        queueCounts={queue.counts}
        queueAvailable={queueAvailable}
        options={options}
        prefill={prefill}
        setup={callingSetupDoor(options.blocker, doors)}
        mayAddToList={mayAddToList}
        mayCreateContacts={organization.capabilities.includes('customer.create')}
        mayRemoveFromList={mayRemoveFromList}
        mayManageTasks={organization.capabilities.includes('follow_up.manage')}
        mayMatchContacts={mayCall}
        mayViewContacts={organization.capabilities.includes('customer.read')}
        actions={<ButtonLink href="#call-history" tone="secondary">Call history</ButtonLink>}
        // The Dialer configures calling, not the whole of Communications.
        settings={doors.filter((door) => door.key === 'call-setup' || door.key === 'phone-numbers').map(({ key, label, href }) => ({ key, label, href }))}
        outcomes={mayCall ? outcomes : undefined}
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
