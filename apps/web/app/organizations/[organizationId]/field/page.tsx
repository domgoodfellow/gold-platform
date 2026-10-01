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
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { areaAvailable, areaHref, areaLabel, workspaceLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Field Home: Work, Schedule, Resources, Locations and Equipment & Assets. Every figure is a count
 * some domain read already owns, one per page, and each links to it — nothing is totalled here and
 * nothing is a target, a rate or a trend. A page the organization does not have (Equipment & Assets
 * without its module) is not drawn and not queried, decided by the same predicate that decides the
 * sidebar's own list of pages.
 */
export default async function FieldPage({ params }: PageProps<'/organizations/[organizationId]/field'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const date = todayInZone(organization.timezone);
  const within = zonedDayRange(date, organization.timezone);

  const featureStates = await organizationResolvedFeatureStates(db, { organizationId });
  const state = {
    enabled: activeModuleKeys(featureStates),
    featureAvailability: availableFeatureKeys(featureStates),
    capabilities: new Set(organization.capabilities),
  };
  const hasAssets = areaAvailable('assets', state);

  const [work, schedule, resources, locations, assets] = await Promise.all([
    listWorkItems(db, { organizationId }),
    listSchedule(db, { organizationId, within, on: { date, timeZone: organization.timezone } }),
    listResources(db, { organizationId }),
    listLocations(db, { organizationId }),
    hasAssets ? listAssets(db, { organizationId }) : Promise.resolve(null),
  ]);

  const href = (segment: string) => areaHref(organizationId, segment);
  const kpis: Kpi[] = [
    { key: 'work', label: areaLabel('work'), value: work.total, note: 'jobs recorded', href: href('work') },
    {
      key: 'schedule',
      label: 'Scheduled today',
      value: schedule.flatMap((entry) => entry.booked).length,
      href: href('schedule'),
    },
    { key: 'resources', label: areaLabel('resources'), value: resources.total, href: href('resources') },
    { key: 'locations', label: areaLabel('locations'), value: locations.total, href: href('locations') },
  ];
  if (assets) kpis.push({ key: 'assets', label: areaLabel('assets'), value: assets.total, href: href('assets') });

  const empty = kpis.every((kpi) => kpi.value === 0);

  return (
    <WorkspaceHome title={workspaceLabel('field')}>
      {empty ? (
        <EmptyState
          title="Nothing recorded in Field yet"
          description="Work, Schedule, Resources, Locations and Equipment & Assets will show here once this business has them."
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
