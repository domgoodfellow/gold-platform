import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState, GroupHeading } from '@/components/surfaces/section';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import {
  AssignNumberForm,
  ConfigureNumberForm,
  ReleaseAssignmentForm,
  UseAsMineForm,
} from '@/features/communications/numbers/number-configuration';
import {
  ORIGIN_EXPLANATION,
  ORIGIN_LABEL,
  PURPOSE_LABEL,
  READINESS_EXPLANATION,
  READINESS_LABEL,
  READINESS_TONE,
  capabilitySummary,
} from '@/features/communications/numbers/labels';
import { listMembers } from '@/lib/domain/tenancy/members';
import { listCallPage } from '@/lib/domain/reception/calls';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import { getPhoneNumber, listPhoneNumberAssignments, resolveOutboundNumber } from '@/lib/domain/reception/numbers';
import { listRoutes } from '@/lib/domain/reception/routing';
import { areaLabel } from '@/lib/navigation';
import { workspaceConfigCrumbs } from '@/lib/settings-nav';
import { requireConfigurationTarget } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * One number's own page: what it is, whether it works, what this business has said it is for, who
 * dials from it, and the calls that have used it. Everything is a fact this organization is
 * entitled to about its own row — never a provider identifier (D39): no account, no SID. What the
 * carrier knows is read as one word (ready, setup required, degraded, unavailable).
 */
export default async function PhoneNumberDetailPage({
  params,
}: PageProps<'/organizations/[organizationId]/comms/configuration/numbers/[phoneNumberId]'>) {
  const { organizationId, phoneNumberId } = await params;
  const { db, organization, gate } = await requireConfigurationTarget(organizationId, 'phone-numbers', true);

  const number = await getPhoneNumber(db, { organizationId, phoneNumberId });
  if (!number) notFound();

  const mayManage = organization.capabilities.includes('organization.manage');
  const mayCall = organization.capabilities.includes('call.place');
  const [assignments, members, mine, usual, routes, recent] = await Promise.all([
    listPhoneNumberAssignments(db, { organizationId }),
    listMembers(db, { organizationId }),
    currentMembershipId(db, { organizationId }),
    mayCall ? resolveOutboundNumber(db, { organizationId }) : Promise.resolve(null),
    listRoutes(db, { organizationId }),
    mayCall ? listCallPage(db, { organizationId, filter: { phoneNumberId }, limit: 5 }) : Promise.resolve({ items: [], nextCursor: null }),
  ]);

  const memberName = new Map(members.map((member) => [member.id, member.displayName]));
  const ownAssignments = assignments.filter((assignment) => assignment.phoneNumberId === number.id);
  const iAmAssigned = ownAssignments.some((assignment) => assignment.memberId === mine);
  const iDialFromIt = usual?.phoneNumberId === number.id;
  const routedBy = routes.filter((route) => route.numberId === number.id && route.enabled);
  const callsBase = `/organizations/${organizationId}/calls`;
  const capabilities = capabilitySummary(number);

  return (
    <AppPage>
      <PageHeader
        title={number.label ? `${number.label} (${number.e164})` : number.e164}
        crumbs={[...workspaceConfigCrumbs(organizationId, 'phone-numbers', gate), { label: areaLabel('comms-numbers'), href: `/organizations/${organizationId}/comms/configuration/numbers` }]}
        meta={<Badge tone={READINESS_TONE[number.readiness]}>{READINESS_LABEL[number.readiness]}</Badge>}
      />

      <section>
        <GroupHeading>This number</GroupHeading>
        <DefinitionList className="mt-2">
          <Detail label="Number">{number.e164}</Detail>
          <Detail label="Name">{number.label}</Detail>
          <Detail label="Used for"><Badge>{PURPOSE_LABEL[number.purpose]}</Badge></Detail>
          <Detail label="Source"><Badge>{ORIGIN_LABEL[number.origin]}</Badge></Detail>
          <Detail label="Status"><Badge tone={READINESS_TONE[number.readiness]}>{READINESS_LABEL[number.readiness]}</Badge></Detail>
          <Detail label="Can do">{capabilities.length ? capabilities.join(' · ') : 'Nothing is switched on'}</Detail>
        </DefinitionList>
        <Hint className="mt-2">{ORIGIN_EXPLANATION[number.origin]} {READINESS_EXPLANATION[number.readiness]}</Hint>
      </section>

      <section className="mt-6">
        <GroupHeading>How this business uses it</GroupHeading>
        {mayManage ? (
          <ConfigureNumberForm organizationId={organizationId} number={number} />
        ) : (
          <Hint className="mt-2">Your role, {organization.role}, cannot change how this number is used.</Hint>
        )}
      </section>

      <section className="mt-6">
        <GroupHeading>Who dials from it</GroupHeading>
        {ownAssignments.length === 0 ? (
          <EmptyState className="mt-2">Nobody is assigned to this number.</EmptyState>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {ownAssignments.map((assignment) => (
              <li key={assignment.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{assignment.memberId ? (memberName.get(assignment.memberId) ?? 'A member') : 'A resource'}</span>
                {assignment.isDefault ? <Badge tone="success">Their default</Badge> : null}
                {mayManage ? <ReleaseAssignmentForm organizationId={organizationId} phoneNumberId={number.id} assignmentId={assignment.id} /> : null}
              </li>
            ))}
          </ul>
        )}
        {mayManage && number.voiceOutboundEnabled ? (
          <AssignNumberForm organizationId={organizationId} phoneNumberId={number.id} members={members.map((member) => ({ id: member.id, displayName: member.displayName }))} />
        ) : null}
        {iDialFromIt ? (
          <Hint className="mt-3">This is the number you dial from.</Hint>
        ) : iAmAssigned && number.voiceOutboundEnabled ? (
          <UseAsMineForm organizationId={organizationId} phoneNumberId={number.id} />
        ) : null}
      </section>

      <section className="mt-6">
        <GroupHeading>Where its calls go</GroupHeading>
        {routedBy.length === 0 ? (
          <Hint className="mt-2">No routing is set for this number. Calls to it are not answered by GildOps yet.</Hint>
        ) : (
          <ul className="mt-2 text-sm">
            {routedBy.map((route) => <li key={route.id}>{route.name}</li>)}
          </ul>
        )}
        <Hint className="mt-2">
          Routing is set under <Link href={`/organizations/${organizationId}/comms/configuration/calling#routing`} className="underline underline-offset-4">Calling & routing</Link>.
        </Hint>
      </section>

      <section className="mt-6">
        <GroupHeading>Recent calls</GroupHeading>
        {!mayCall ? <Hint className="mt-2">Your role cannot view call history.</Hint> :
        recent.items.length === 0 ? (
          <Hint className="mt-2">No calls have used this number yet.</Hint>
        ) : (
          <>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {recent.items.map((call) => (
                <li key={call.id}>
                  <Link href={`${callsBase}/${call.id}`} className="underline underline-offset-4">
                    {call.customerName ?? call.externalNumber ?? 'Withheld number'}
                  </Link>
                  <span className="ml-2 text-muted">{call.direction === 'inbound' ? 'Inbound' : 'Outbound'}</span>
                </li>
              ))}
            </ul>
            <Link href={`${callsBase}?number=${number.id}`} className="mt-2 inline-block text-sm underline underline-offset-4">All calls on this number</Link>
          </>
        )}
      </section>
    </AppPage>
  );
}
