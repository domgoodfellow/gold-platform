import { Phone } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { SectionHeading } from '@/components/surfaces/section';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { Button } from '@/components/controls/button';
import { CallFilters, callFilterFromParams, callsHref, parseCallParams } from '@/features/communications/voice/call-filters';
import { CallHistory } from '@/features/communications/voice/call-history';
import { NewCallForm } from '@/features/communications/voice/new-call-form';
import { VoiceCounters, VoiceDayDetail } from '@/features/communications/voice/voice-overview';
import { VoiceSettingsSheet } from '@/features/communications/voice/voice-settings-sheet';
import { WrapUpCallSheet } from '@/features/communications/voice/wrap-up-sheet';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { getCallCounts, listCallPage } from '@/lib/domain/reception/calls';
import { listPhoneNumbers, resolveOutboundNumber } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { listRoutes } from '@/lib/domain/reception/routing';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { listMembers } from '@/lib/domain/tenancy/members';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * The voice history and operating surface: every call this business made or took, inbound and
 * outbound in one list, filtered and paged by the database, each one opening to its own page.
 * The day's numbers sit above it and lead into it. There is no second place calls are listed.
 */
export default async function CallsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const { params: callParams, cursor } = parseCallParams(await searchParams);
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const mayCall = organization.capabilities.includes('call.place');
  const base = `/organizations/${organizationId}/calls`;

  const [page, counts, todays, outcomes, stages, customers, number, routes, numbers, members, usual] = await Promise.all([
    listCallPage(db, { organizationId, filter: callFilterFromParams(callParams, organization.timezone), cursor }),
    getCallCounts(db, { organizationId, dayStart: day.startsAt, dayEnd: day.endsAt }),
    listCallPage(db, { organizationId, filter: { since: day.startsAt, until: day.endsAt }, limit: 100 }),
    listCallOutcomes(db, { organizationId }),
    listCustomerStages(db, { organizationId }),
    listCustomers(db, { organizationId }),
    callingNumber(db, { organizationId }),
    listRoutes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    listMembers(db, { organizationId }),
    mayCall ? resolveOutboundNumber(db, { organizationId }) : Promise.resolve(null),
  ]);

  const numberById = new Map(numbers.map((entry) => [entry.id, { e164: entry.e164, label: entry.label }]));
  const dialable = numbers
    .filter((entry) => entry.voiceOutboundEnabled && entry.readiness === 'ready' && entry.lifecycle === 'active' && (entry.origin === 'provisioned' || entry.origin === 'external'))
    .map((entry) => ({ id: entry.id, e164: entry.e164, label: entry.label }));
  const usualNumber = usual ? { id: usual.phoneNumberId, e164: usual.e164, label: numberById.get(usual.phoneNumberId)?.label ?? null } : null;
  const filtered = Object.keys(callParams).length > 0;

  return (
    <WorkspaceHome
      title={areaLabel('calls')}
      crumbs={workspaceAncestry(organizationId, 'calls')}
      actions={
        <>
          {mayCall ? (
            <PageDrawer>
              <PageDrawerTrigger asChild><Button type="button"><Phone aria-hidden /> New call</Button></PageDrawerTrigger>
              <PageDrawerContent>
                <PageDrawerHeader>
                  <PageDrawerTitle>New call</PageDrawerTitle>
                  <PageDrawerDescription>Ring a number from this browser. The call joins the history below as it begins.</PageDrawerDescription>
                </PageDrawerHeader>
                <div className="px-4 pb-4"><NewCallForm organizationId={organizationId} numbers={dialable} defaultNumber={usualNumber} /></div>
              </PageDrawerContent>
            </PageDrawer>
          ) : null}
          <div id="setup" className="scroll-mt-20">
            <VoiceSettingsSheet
              organizationId={organizationId}
              number={number}
              outcomes={outcomes}
              routes={routes}
              numbers={numbers}
              members={members.map((member) => ({ id: member.id, displayName: member.displayName }))}
              mayManageIdentity={organization.capabilities.includes('organization.manage')}
              mayConfigureOutcomes={organization.capabilities.includes('field.manage')}
              role={organization.role}
            />
          </div>
        </>
      }
    >
      <VoiceCounters organizationId={organizationId} counts={counts} todaysCalls={todays.items} />

      <section className="mt-8" aria-labelledby="call-history">
        <SectionHeading id="call-history">Call history</SectionHeading>
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
      </section>

      <VoiceDayDetail organizationId={organizationId} todaysCalls={todays.items} customers={customers} stages={stages} />
    </WorkspaceHome>
  );
}
