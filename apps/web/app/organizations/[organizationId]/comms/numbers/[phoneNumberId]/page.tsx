import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState, GroupHeading } from '@/components/surfaces/section';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { ORIGIN_LABEL } from '@/features/communications/numbers/number-list';
import { listMembers } from '@/lib/domain/tenancy/members';
import {
  effectiveOutboundNumber,
  getPhoneNumber,
  listPhoneNumberAssignments,
} from '@/lib/domain/reception/numbers';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

const LIFECYCLE_TONE = { active: 'success', inactive: 'neutral', quarantined: 'danger' } as const;
const HEALTH_TONE: Record<string, 'success' | 'neutral' | 'danger'> = {
  healthy: 'success',
  unknown: 'neutral',
  degraded: 'danger',
  failed: 'danger',
};

/**
 * One number's own page. Everything here is a fact this organization is entitled to about its
 * own row — never a provider identifier (D39): no subaccount, no SID, only what a business
 * already sees on `phone_numbers`/`phone_number_assignments`.
 */
export default async function PhoneNumberDetailPage({
  params,
}: PageProps<'/organizations/[organizationId]/comms/numbers/[phoneNumberId]'>) {
  const { organizationId, phoneNumberId } = await params;
  const { db } = await requireOrganization(organizationId);

  const number = await getPhoneNumber(db, { organizationId, phoneNumberId });
  if (!number) notFound();

  const [assignments, members, defaultOutbound] = await Promise.all([
    listPhoneNumberAssignments(db, { organizationId }),
    listMembers(db, { organizationId }),
    effectiveOutboundNumber(db, { organizationId }),
  ]);

  const memberName = new Map(members.map((member) => [member.id, member.displayName]));
  const ownAssignments = assignments.filter((assignment) => assignment.phoneNumberId === number.id);
  const isOrganizationDefault = defaultOutbound === number.e164;

  return (
    <AppPage>
      <PageHeader
        title={number.label ? `${number.e164} (${number.label})` : number.e164}
        crumbs={[...workspaceAncestry(organizationId, 'comms-numbers'), { label: areaLabel('comms-numbers'), href: `/organizations/${organizationId}/comms/numbers` }]}
        description="Capabilities, assignment and status for this number."
      />

      <section>
        <GroupHeading>Identity</GroupHeading>
        <DefinitionList className="mt-2">
          <Detail label="Number">{number.e164}</Detail>
          <Detail label="Label">{number.label}</Detail>
          <Detail label="Origin"><Badge>{ORIGIN_LABEL[number.origin]}</Badge></Detail>
          <Detail label="Purpose"><Badge>{number.purpose}</Badge></Detail>
          <Detail label="Status"><Badge tone={LIFECYCLE_TONE[number.lifecycle]}>{number.lifecycle}</Badge></Detail>
        </DefinitionList>
      </section>

      <section className="mt-6">
        <GroupHeading>Capabilities</GroupHeading>
        <div className="mt-2 flex flex-wrap gap-2">
          {number.inboundEnabled ? <Badge>Inbound calls</Badge> : null}
          {number.outboundEnabled ? <Badge>Outbound calls</Badge> : null}
          {!number.inboundEnabled && !number.outboundEnabled ? <span className="text-sm text-subtle">None enabled</span> : null}
        </div>
        <Hint className="mt-2">Messaging capability is not available on this deployment yet.</Hint>
      </section>

      <section className="mt-6">
        <GroupHeading>Health</GroupHeading>
        <DefinitionList className="mt-2">
          <Detail label="State"><Badge tone={HEALTH_TONE[number.health] ?? 'neutral'}>{number.health}</Badge></Detail>
        </DefinitionList>
      </section>

      <section className="mt-6">
        <GroupHeading>Caller identity</GroupHeading>
        <DefinitionList className="mt-2">
          <Detail label="Business default">{isOrganizationDefault ? <Badge tone="success">Default outbound number</Badge> : null}</Detail>
        </DefinitionList>
        {ownAssignments.length === 0 ? (
          <EmptyState className="mt-2">Nobody is assigned to this number.</EmptyState>
        ) : (
          <ul className="mt-2 space-y-1">
            {ownAssignments.map((assignment) => (
              <li key={assignment.id} className="flex items-center gap-2 text-sm">
                <span>{assignment.memberId ? (memberName.get(assignment.memberId) ?? 'A member') : 'A resource'}</span>
                {assignment.isDefault ? <Badge tone="success">Default</Badge> : null}
              </li>
            ))}
          </ul>
        )}
        <Hint className="mt-3">
          Trust and verification state (SHAKEN/STIR, CNAM, branded calling) is not available on this deployment yet.
        </Hint>
      </section>

      <section className="mt-6">
        <GroupHeading>Compliance</GroupHeading>
        <Hint className="mt-2">No compliance state is tracked for numbers yet.</Hint>
      </section>

      <section className="mt-6">
        <GroupHeading>Activity</GroupHeading>
        <Hint className="mt-2">No activity is recorded for a number on its own yet — see Calls for calling history.</Hint>
      </section>
    </AppPage>
  );
}
