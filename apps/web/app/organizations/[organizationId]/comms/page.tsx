import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { KpiCard, type Kpi } from '@/components/surfaces/kpi-card';
import { EmptyState, GroupHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { listCalls } from '@/lib/domain/reception/calls';
import { currentMembershipId, getInboxCounts } from '@/lib/domain/reception/inbox';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { communicationsProviderReadiness } from '@/lib/domain/reception/provider-readiness';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Communications Home. Every figure is a count some domain read already owns — nothing is
 * totalled here.
 */
export default async function CommsPage({ params }: PageProps<'/organizations/[organizationId]/comms'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Calling and messaging are two authorities (`call.place`, `message.send`). Each half of this
  // page is read, counted and warned about only for a person who holds it, so a messaging-only
  // member is never told a dialer cannot place a call and a calling-only member is never shown a
  // text count.
  const mayCall = organization.capabilities.includes('call.place');
  const mayMessage = organization.capabilities.includes('message.send');

  const [calls, numbers, number, readiness, inbox] = await Promise.all([
    mayCall ? listCalls(db, { organizationId }) : null,
    listPhoneNumbers(db, { organizationId }),
    mayCall ? callingNumber(db, { organizationId }) : null,
    communicationsProviderReadiness(db, { organizationId }),
    mayMessage ? currentMembershipId(db, { organizationId }).then((membershipId) => getInboxCounts(db, { organizationId, membershipId })) : null,
  ]);

  const href = (segment: string) => areaHref(organizationId, segment);
  const kpis: Kpi[] = [];
  if (calls) {
    const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
    const today = calls.filter((call) => call.startedAt >= day.startsAt && call.startedAt < day.endsAt);
    kpis.push(
      { key: 'calls-today', label: 'Calls today', value: today.length, href: href('calls') },
      { key: 'calls', label: areaLabel('calls'), value: calls.total, note: 'recorded', href: href('calls') },
    );
  }
  kpis.push({ key: 'numbers', label: areaLabel('comms-numbers'), value: numbers.length, note: 'owned', href: href('comms-numbers') });
  if (inbox) {
    // Home is the overview; each figure leads into the Inbox already narrowed to what it counts.
    const inboxHref = (query: string) => `${href('comms-inbox')}${query}`;
    kpis.push(
      { key: 'inbox-unread', label: `${areaLabel('comms-inbox')}: unread`, value: inbox.unread, note: 'to read', href: inboxHref('?view=unread') },
      { key: 'inbox-open', label: 'Open conversations', value: inbox.open, note: 'awaiting a reply', href: inboxHref('?status=open') },
      { key: 'inbox-unassigned', label: 'Unassigned', value: inbox.unassigned, note: 'no one handling', href: inboxHref('?view=unassigned') },
      { key: 'inbox-mine', label: 'Assigned to me', value: inbox.mine, note: 'active', href: inboxHref('?view=mine') },
    );
  }

  const channel = mayCall && mayMessage ? 'calling and texting' : mayCall ? 'calling' : 'texting';
  const issues: string[] = [];
  if (mayCall && !number) issues.push('No outbound number is set — the dialer cannot place a call.');
  if (numbers.length === 0) issues.push('No number is recorded in the inventory yet.');
  if (readiness === 'provisioning') issues.push(`This business’s own ${channel} connection is still being set up.`);
  if (readiness === 'error') issues.push(`This business’s own ${channel} connection needs attention.`);
  if (readiness === 'not_ready') issues.push(`This business’s own ${channel} connection is not active.`);

  const empty = (calls?.total ?? 0) === 0 && numbers.length === 0 && (inbox ? inbox.open + inbox.waiting : 0) === 0;

  return (
    <WorkspaceHome title={workspaceLabel('communications')}>
      {empty ? (
        <EmptyState
          title="Nothing recorded in Communications yet"
          description={mayCall && !mayMessage ? 'Calls and numbers for this business will show here.' : mayMessage && !mayCall ? 'Text conversations and numbers for this business will show here.' : 'Calls, numbers and conversations for this business will show here.'}
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      )}
      {issues.length > 0 ? (
        <section className="mt-6">
          <GroupHeading>Readiness</GroupHeading>
          <ul className="mt-2 space-y-1">
            {issues.map((issue) => (
              <li key={issue}><Hint>{issue}</Hint></li>
            ))}
          </ul>
        </section>
      ) : null}
    </WorkspaceHome>
  );
}
