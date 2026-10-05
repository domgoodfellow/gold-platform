import { WorkspaceHome } from '@/components/patterns/workspace-home';
import { KpiCard, type Kpi } from '@/components/surfaces/kpi-card';
import { EmptyState } from '@/components/surfaces/section';
import {
  activeModuleKeys,
  availableFeatureKeys,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { listAssets } from '@/lib/domain/assets/assets';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResources } from '@/lib/domain/resources/resources';
import { listScheduleDays } from '@/lib/domain/scheduling/availability';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { areaAvailable, areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Field Home: Work, Schedule, Resources, Locations and Equipment & Assets. Every figure is a count
 * some domain read already owns, one per page, and each links to it — nothing is totalled here and
 * nothing is a target, a rate or a trend. A page the organization does not have (Equipment & Assets
 * without its module, or Schedule, Resources and Locations for a business that has declared no
 * work as scheduled) is not drawn and not queried, decided by the same predicate that decides the
 * sidebar's own list of pages. Whether a page *exists* for this business comes from that
 * declaration and never from how many rows it has: zero scheduled jobs is still a schedule.
 */
export default async function FieldPage({ params }: PageProps<'/organizations/[organizationId]/field'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const date = todayInZone(organization.timezone);

  const featureStates = await organizationResolvedFeatureStates(db, { organizationId });
  const state = {
    enabled: activeModuleKeys(featureStates),
    featureAvailability: availableFeatureKeys(featureStates),
    capabilities: new Set(organization.capabilities),
    schedulableWork: await hasSchedulableWork(db, { organizationId }),
  };
  const hasAssets = areaAvailable('assets', state);
  const hasSchedule = areaAvailable('schedule', state);
  const hasResources = areaAvailable('resources', state);
  const hasLocations = areaAvailable('locations', state);

  const [work, schedule, resources, locations, assets] = await Promise.all([
    listWorkItems(db, { organizationId }),
    hasSchedule
      ? listScheduleDays(db, { organizationId, dates: [date], timeZone: organization.timezone })
      : Promise.resolve(null),
    hasResources ? listResources(db, { organizationId }) : Promise.resolve(null),
    hasLocations ? listLocations(db, { organizationId }) : Promise.resolve(null),
    hasAssets ? listAssets(db, { organizationId }) : Promise.resolve(null),
  ]);

  const href = (segment: string) => areaHref(organizationId, segment);
  const kpis: Kpi[] = [
    { key: 'work', label: areaLabel('work'), value: work.total, note: 'jobs recorded', href: href('work') },
  ];
  if (schedule) {
    kpis.push({
      key: 'schedule',
      label: 'Scheduled today',
      // Work items, not assignments: three resources on one job is one job scheduled today.
      value: new Set([
        ...(schedule[0]?.resources ?? []).flatMap((entry) => entry.booked.map((booking) => booking.workItemId)),
        ...(schedule[0]?.unassigned ?? []).map((work) => work.workItemId),
      ]).size,
      href: href('schedule'),
    });
  }
  if (resources) kpis.push({ key: 'resources', label: areaLabel('resources'), value: resources.total, href: href('resources') });
  if (locations) kpis.push({ key: 'locations', label: areaLabel('locations'), value: locations.total, href: href('locations') });
  if (assets) kpis.push({ key: 'assets', label: areaLabel('assets'), value: assets.total, href: href('assets') });

  const empty = kpis.every((kpi) => kpi.value === 0);

  return (
    <WorkspaceHome title={workspaceLabel('field')}>
      {empty ? (
        <EmptyState
          title="Nothing recorded in Field yet"
          description={
            hasSchedule
              ? 'Work, Schedule, Resources, Locations and Equipment & Assets will show here once this business has them.'
              : 'Work will show here once this business has recorded some.'
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      )}
    </WorkspaceHome>
  );
}
