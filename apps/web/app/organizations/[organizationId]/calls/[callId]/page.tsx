import { formatPhoneForDisplay } from '@/lib/display/phone';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { GroupHeading } from '@/components/surfaces/section';
import { LinkCustomerForm } from '@/features/communications/voice/link-customer-form';
import { WrapUpCallSheet } from '@/features/communications/voice/wrap-up-sheet';
import {
  NAMELESS_LABEL,
  PARTY_LABEL,
  callTimeline,
  callerName,
  callStatusTone,
  formatCallDuration,
  formatCallTime,
} from '@/features/communications/voice/format';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { callStatusLabel, getCall } from '@/lib/domain/reception/calls';
import { getPhoneNumber } from '@/lib/domain/reception/numbers';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * One call, as the business sees it: who it was with, which way it went, how it ended, who from the
 * business was on it, what was said about it afterwards and, where there is one, its recording.
 * Everything is the business's own vocabulary — no carrier identifier is read, so none can be shown.
 * This is a record, not the live call: a call in progress is operated from the dock.
 */
export default async function CallDetailPage({
  params,
}: PageProps<'/organizations/[organizationId]/calls/[callId]'>) {
  const { organizationId, callId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'calls');

  const call = await getCall(db, { organizationId, callId });
  if (!call) notFound();

  const mayCall = organization.capabilities.includes('call.place');
  const mayPlay = mayCall || organization.capabilities.includes('organization.manage');
  const [number, outcomes, customers] = await Promise.all([
    call.phoneNumberId ? getPhoneNumber(db, { organizationId, phoneNumberId: call.phoneNumberId }) : Promise.resolve(null),
    listCallOutcomes(db, { organizationId }),
    call.customerId === null && mayCall ? listContacts(db, { organizationId }) : Promise.resolve([]),
  ]);

  const timeZone = organization.timezone;
  const live = call.status === 'ringing' || call.status === 'in_progress';
  const businessNumber = call.direction === 'outbound' ? call.fromNumber : call.toNumber;
  const timeline = callTimeline(call);

  return (
    <AppPage>
      <RelatedSupport organizationId={organizationId} kind="call" recordId={callId} customerId={call.customerId}/>
      <PageHeader
        title={callerName(call)}
        crumbs={[
          ...workspaceAncestry(organizationId, 'calls'),
          { label: areaLabel('calls'), href: `/organizations/${organizationId}/calls` },
        ]}
        meta={
          <>
            <Badge>{call.direction === 'inbound' ? 'Inbound' : 'Outbound'}</Badge>
            <Badge tone={callStatusTone(call)}>{callStatusLabel(call)}</Badge>
          </>
        }
        actions={mayCall && call.status === 'completed' ? <WrapUpCallSheet organizationId={organizationId} call={call} outcomes={outcomes} /> : undefined}
      />

      {live ? (
        <Hint className="mb-4">
          This call is still going. It is operated from the call bar at the bottom of the screen on the browser that placed it; if that
          browser was closed or reloaded, no one from the business is on it until it ends.
        </Hint>
      ) : null}

      <section>
        <GroupHeading>Call</GroupHeading>
        <DefinitionList className="mt-2">
          <Detail label="Started">{formatCallTime(call.startedAt, timeZone)}</Detail>
          <Detail label="Answered">{call.answeredAt ? formatCallTime(call.answeredAt, timeZone) : null}</Detail>
          <Detail label="Ended">{call.endedAt ? formatCallTime(call.endedAt, timeZone) : null}</Detail>
          <Detail label="Duration">{call.answeredAt ? formatCallDuration(call.durationSeconds) : null}</Detail>
          <Detail label="Their number">{call.externalNumber ? formatPhoneForDisplay(call.externalNumber) : 'Withheld'}</Detail>
          <Detail label="Our number">
            {number ? (
              <Link href={`/organizations/${organizationId}/comms/configuration/numbers/${number.id}`} className="underline underline-offset-4">
                {number.label ? `${number.label} (${formatPhoneForDisplay(number.e164)})` : formatPhoneForDisplay(number.e164)}
              </Link>
            ) : (
              businessNumber ? formatPhoneForDisplay(businessNumber) : null
            )}
          </Detail>
          <Detail label="Handled by">{call.handledBy.map((member) => member.name).join(', ')}</Detail>
        </DefinitionList>
      </section>

      <section className="mt-6">
        <GroupHeading>Contact</GroupHeading>
        {call.customerId ? (
          <p className="mt-2 text-sm">
            <Link href={`/organizations/${organizationId}/crm/contacts/${call.customerId}`} className="underline underline-offset-4">
              {call.customerName ?? 'Contact'}
            </Link>
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm">Unknown caller{call.externalNumber ? ` — ${formatPhoneForDisplay(call.externalNumber)}` : ''}. No customer holds this number, or more than one does.</p>
            {mayCall ? <LinkCustomerForm organizationId={organizationId} callId={call.id} customers={customers.map((customer) => ({ id: customer.id, name: customer.name }))} /> : null}
          </div>
        )}
      </section>

      <section className="mt-6">
        <GroupHeading>Outcome</GroupHeading>
        <DefinitionList className="mt-2">
          <Detail label="How it went">{call.outcome?.name ?? <span className="text-subtle">Not written up</span>}</Detail>
          <Detail label="Note">{call.note}</Detail>
        </DefinitionList>
      </section>

      <section className="mt-6">
        <GroupHeading>Recording</GroupHeading>
        {call.hasRecording && mayPlay ? (
          <audio controls preload="none" className="mt-2 w-full max-w-md" src={`/organizations/${organizationId}/calls/${call.id}/recording`} />
        ) : call.hasRecording ? (
          <Hint className="mt-2">This call was recorded. Your role, {organization.role}, cannot play recordings.</Hint>
        ) : (
          <Hint className="mt-2">No recording for this call.</Hint>
        )}
      </section>

      <section className="mt-6">
        <GroupHeading>Who was on it</GroupHeading>
        {call.legs.length === 0 ? (
          <Hint className="mt-2">Nobody is recorded on this call — it was written down by hand.</Hint>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {call.legs.map((leg) => (
              <li key={leg.id} className="flex flex-wrap items-center gap-2">
                <span>{leg.party === 'customer' ? (call.customerName ?? NAMELESS_LABEL.customer) : (leg.name ?? NAMELESS_LABEL[leg.party])}</span>
                <Badge>{PARTY_LABEL[leg.party]}</Badge>
                {leg.joinedAt ? <span className="text-muted">joined {formatCallTime(leg.joinedAt, timeZone)}</span> : <span className="text-muted">never connected</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <GroupHeading>Timeline</GroupHeading>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {timeline.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex gap-3">
              <span className="w-28 shrink-0 text-muted tabular-nums">{formatCallTime(entry.at, timeZone)}</span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </AppPage>
  );
}
import { RelatedSupport } from '@/features/support/related';
