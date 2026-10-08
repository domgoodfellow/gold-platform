import { requireOrganization } from '@/lib/route/organization';
import { workOperations } from '@/lib/application/work/operations';
import { workCreateOptions } from '@/lib/application/work/create-options';
import { WorkHome } from '@/features/work/home/work-home';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { parseScheduleDate } from '@/features/scheduling/calendar/schedule-url';
import { areaAvailable } from '@/lib/navigation';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';

export const dynamic = 'force-dynamic';
export default async function FieldPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/field'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const date = parseScheduleDate(query.on, todayInZone(organization.timezone));
  const features = await organizationResolvedFeatureStates(db, { organizationId });
  const state = { enabled: activeModuleKeys(features), featureAvailability: availableFeatureKeys(features), capabilities: new Set(organization.capabilities), schedulableWork: await hasSchedulableWork(db, { organizationId }) };
  const destinations = { resources: areaAvailable('resources', state), locations: areaAvailable('locations', state), assets: areaAvailable('assets', state), schedule: areaAvailable('schedule', state) };
  const [data, createOptions] = await Promise.all([
    workOperations(db, organizationId, date, organization.timezone),
    organization.capabilities.includes('work_item.create') ? workCreateOptions(db, organizationId, destinations.assets) : Promise.resolve(null),
  ]);
  return <WorkHome organizationId={organizationId} timezone={organization.timezone} data={data} createOptions={createOptions} mayConfigure={organization.capabilities.includes('field.manage')} destinations={destinations}
    activity={<WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="work" emptyMessage="No work activity yet." limit={5} dense/>}/>;
}
