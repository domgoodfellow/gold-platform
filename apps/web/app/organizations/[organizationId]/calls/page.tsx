import { Phone } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { SectionHeading } from '@/components/surfaces/section';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/panels/page-drawer';
import { Button } from '@/components/controls/button';
import { CallFilters, callFilterFromParams, callsHref, parseCallParams } from '@/features/communications/voice/call-filters';
import { CallHistory } from '@/features/communications/voice/call-history';
import { NewCallForm } from '@/features/communications/voice/new-call-form';
import { VoiceCounters } from '@/features/communications/voice/voice-overview';
import { WorkspaceConfigure } from '@/features/settings/workspace-configure';
import { WrapUpCallSheet } from '@/features/communications/voice/wrap-up-sheet';
import { getCallCounts, listCallPage } from '@/lib/domain/reception/calls';
import { listPhoneNumbers, resolveOutboundNumber } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { listMembers } from '@/lib/domain/tenancy/members';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { callingRuntimeConfigured } from '@/lib/application/communications/calling-runtime';
import { communicationsProviderReadiness } from '@/lib/domain/reception/provider-readiness';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * The voice history and operating surface: every call this business made or took, inbound and
 * outbound in one list, filtered and paged by the database, each one opening to its own page.
 * The day's numbers sit above it and lead into it. There is no second place calls are listed.
 */
export default async function CallsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/calls'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'calls');
  const { params: callParams, cursor } = parseCallParams(await searchParams);
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const mayCall = organization.capabilities.includes('call.place');
  const base = `/organizations/${organizationId}/calls`;

  const [page, counts, todays, outcomes, numbers, members, usual, runtimeConfigured, readiness, featureStates] = await Promise.all([
    listCallPage(db, { organizationId, filter: callFilterFromParams(callParams, organization.timezone), cursor }),
    getCallCounts(db, { organizationId, dayStart: day.startsAt, dayEnd: day.endsAt }),
    listCallPage(db, { organizationId, filter: { since: day.startsAt, until: day.endsAt }, limit: 100 }),
    listCallOutcomes(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    listMembers(db, { organizationId }),
    mayCall ? resolveOutboundNumber(db, { organizationId }) : Promise.resolve(null),
    callingRuntimeConfigured(mayCall),
    communicationsProviderReadiness(db, { organizationId }),
    organizationResolvedFeatureStates(db, { organizationId }),
  ]);

  const numberById = new Map(numbers.map((entry) => [entry.id, { e164: entry.e164, label: entry.label }]));
  const canCall = mayCall && availableFeatureKeys(featureStates).has('outbound_calling');
  const runtimeReady = canCall && runtimeConfigured && readiness === 'ready';
  const dialable = (runtimeReady ? numbers : [])
    .filter((entry) => entry.voiceOutboundEnabled && entry.readiness === 'ready' && entry.lifecycle === 'active' && (entry.origin === 'provisioned' || entry.origin === 'external'))
    .map((entry) => ({ id: entry.id, e164: entry.e164, label: entry.label }));
  const usualNumber = runtimeReady && usual ? { id: usual.phoneNumberId, e164: usual.e164, label: numberById.get(usual.phoneNumberId)?.label ?? null } : null;
  const filtered = Object.keys(callParams).length > 0;

  return (
    <AppPage>
    <CollectionHeader
      title={areaLabel('calls')}
      crumbs={workspaceAncestry(organizationId, 'calls')}
      actions={
        <>
          {canCall ? (
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
          <WorkspaceConfigure organizationId={organizationId} workspace="communications" />
        </>
      }
    />
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

    </AppPage>
  );
}
