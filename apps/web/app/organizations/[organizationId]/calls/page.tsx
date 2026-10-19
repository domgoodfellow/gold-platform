import { ButtonLink } from '@/components/controls/button';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { SectionHeading } from '@/components/surfaces/section';
import { CallFilters, callFilterFromParams, callsHref, parseCallParams } from '@/features/communications/voice/call-filters';
import { CallHistory } from '@/features/communications/voice/call-history';
import { VoiceCounters } from '@/features/communications/voice/voice-overview';
import { WorkspaceConfigure } from '@/features/settings/workspace-configure';
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

export const dynamic = 'force-dynamic';

export default async function CallsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'calls');
  const query = await searchParams;
  const { params: callParams, cursor } = parseCallParams(query);
  const prefill = typeof query.to === 'string' && /^\+[1-9][0-9]{7,14}$/.test(query.to) ? query.to : '';
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const mayCall = organization.capabilities.includes('call.place');
  const base = `/organizations/${organizationId}/calls`;

  const [page, counts, todays, outcomes, numbers, members, options, queueAvailable] = await Promise.all([
    listCallPage(db, { organizationId, filter: callFilterFromParams(callParams, organization.timezone), cursor }),
    getCallCounts(db, { organizationId, dayStart: day.startsAt, dayEnd: day.endsAt }),
    listCallPage(db, { organizationId, filter: { since: day.startsAt, until: day.endsAt }, limit: 100 }),
    listCallOutcomes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    listMembers(db, { organizationId }),
    loadCallingOptions(db, { organizationId, mayCall }),
    followUpsAvailable(db, organizationId),
  ]);

  const numberById = new Map(numbers.map((entry) => [entry.id, { e164: entry.e164, label: entry.label }]));
  const queue = queueAvailable ? await loadDialerQueue(db, organizationId) : { items: [], total: 0 };
  const filtered = Object.keys(callParams).length > 0;

  return (
    <AppPage>
    <CollectionHeader
      title={areaLabel('calls')}
      crumbs={workspaceAncestry(organizationId, 'calls')}
      actions={
        <>
          <ButtonLink href="#call-history" tone="secondary">Call history</ButtonLink>
          <WorkspaceConfigure organizationId={organizationId} workspace="communications" />
        </>
      }
    />
      <DialerWorkspace organizationId={organizationId} timezone={organization.timezone} queue={queue.items} queueTotal={queue.total} queueAvailable={queueAvailable} options={options} prefill={prefill} history={<section id="call-history" className="mt-8 scroll-mt-20" aria-labelledby="call-history-heading">
        <VoiceCounters organizationId={organizationId} counts={counts} todaysCalls={todays.items} />
        <SectionHeading id="call-history-heading">Call history</SectionHeading>
        <div className="mt-3">
          <CallFilters
            base={base}
            params={callParams}
            numbers={numbers.map((entry) => ({ id: entry.id, e164: entry.e164, label: entry.label }))}
            members={members.map((member) => ({ id: member.id, displayName: member.displayName }))}
          />
        </div>
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
          {cursor ? <ButtonLink href={callsHref(base, callParams)} scroll={false} tone="secondary" size="small">Newest calls</ButtonLink> : null}
          {page.nextCursor ? <ButtonLink href={callsHref(base, callParams, page.nextCursor)} scroll={false} tone="secondary" size="small">Older calls</ButtonLink> : null}
        </nav>
      </section>} />

    </AppPage>
  );
}
