import { AppPage } from '@/components/containers/app-page';
import { KpiCard, type Kpi } from '@/components/containers/kpi-card';
import { PageHeader } from '@/components/containers/page-header';
import { EmptyState } from '@/components/containers/section';
import { listCalls } from '@/lib/domain/reception/calls';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Communications Home: Calls, the one channel implemented. Every figure is a count some domain
 * read already owns — nothing is totalled here. SMS, email and an inbox get their own KPI the day
 * each becomes a real page.
 */
export default async function CommsPage({ params }: PageProps<'/organizations/[organizationId]/comms'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const calls = await listCalls(db, { organizationId });
  const day = zonedDayRange(todayInZone(organization.timezone), organization.timezone);
  const today = calls.filter((call) => call.startedAt >= day.startsAt && call.startedAt < day.endsAt);

  const href = (segment: string) => areaHref(organizationId, segment);
  const kpis: Kpi[] = [
    { key: 'calls-today', label: 'Calls today', value: today.length, href: href('calls') },
    { key: 'calls', label: areaLabel('calls'), value: calls.total, note: 'recorded', href: href('calls') },
  ];

  const empty = calls.total === 0;

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
    </AppPage>
  );
}
