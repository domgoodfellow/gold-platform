import { AppPage } from '@/components/containers/app-page';
import { KpiCard, type Kpi } from '@/components/containers/kpi-card';
import { PageHeader } from '@/components/containers/page-header';
import { EmptyState, GroupHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { listCalls } from '@/lib/domain/reception/calls';
import { listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { communicationsProviderReadiness } from '@/lib/domain/reception/provider-readiness';
import { callingNumber } from '@/lib/domain/reception/telephony';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Communications Home. Every figure is a count some domain read already owns — nothing is
 * totalled here. Messaging draws no figure: the catalogue carries SMS as `planned`, so a count
 * would claim activity that cannot happen yet — the readiness line says so instead.
 */
export default async function CommsPage({ params }: PageProps<'/organizations/[organizationId]/comms'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [calls, numbers, number, readiness] = await Promise.all([
    listCalls(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    callingNumber(db, { organizationId }),
    communicationsProviderReadiness(db, { organizationId }),
  ]);
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const today = calls.filter((call) => call.startedAt >= day.startsAt && call.startedAt < day.endsAt);
  const mayCall = organization.capabilities.includes('call.place');

  const href = (segment: string) => areaHref(organizationId, segment);
  const kpis: Kpi[] = [
    { key: 'calls-today', label: 'Calls today', value: today.length, href: href('calls') },
    { key: 'calls', label: areaLabel('calls'), value: calls.total, note: 'recorded', href: href('calls') },
    { key: 'numbers', label: areaLabel('comms-numbers'), value: numbers.length, note: 'owned', href: href('comms-numbers') },
  ];

  const issues: string[] = [];
  if (mayCall && !number) issues.push('No outbound number is set — the dialer cannot place a call.');
  if (numbers.length === 0) issues.push('No number is recorded in the inventory yet.');
  if (readiness === 'provisioning') issues.push('This business’s own calling connection is still being set up.');
  if (readiness === 'error') issues.push('This business’s own calling connection needs attention.');
  if (readiness === 'not_ready') issues.push('This business’s own calling connection is not active.');

  const empty = calls.total === 0 && numbers.length === 0;

  return (
    <AppPage>
      <PageHeader
        title={workspaceLabel('comms')}
        description="Calling activity, follow-up and the identity this business calls from."
      />
      {empty ? (
        <EmptyState>Nothing has been recorded in Communications yet.</EmptyState>
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
      <Hint className="mt-6">Text messaging is not available on this deployment yet.</Hint>
    </AppPage>
  );
}
