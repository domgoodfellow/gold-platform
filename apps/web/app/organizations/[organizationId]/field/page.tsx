import { WorkspaceConfigure } from '@/features/settings/workspace-configure';
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
import { getBusinessProfile } from '@/lib/domain/tenancy/business-profile';
import { projectBusinessNavigation } from '@/lib/application/shell/business-navigation';
import { workspaceShortcuts } from '@/lib/shell';

export const dynamic = 'force-dynamic';
export default async function FieldPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/field'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const date = parseScheduleDate(query.on, todayInZone(organization.timezone));
  const features = await organizationResolvedFeatureStates(db, { organizationId });
  const state = { enabled: activeModuleKeys(features), featureAvailability: availableFeatureKeys(features), capabilities: new Set(organization.capabilities), schedulableWork: await hasSchedulableWork(db, { organizationId }) };
  // Whether new work may name an asset: the same availability the Assets destination uses.
  const assetsAvailable = areaAvailable('assets', state);
  // Manage Work's shortcuts come from the projection the sidebar draws: its routes, authorization and business labels.
  const sections = projectBusinessNavigation({ organizationId, enabledModules: state.enabled, featureAvailability: state.featureAvailability, capabilities: state.capabilities, schedulableWork: state.schedulableWork }, await getBusinessProfile(db, organizationId));
  const shortcuts = workspaceShortcuts(sections, 'field', { destinations: ['work', 'resources', 'locations', 'assets'], calendar: true, configuration: ['schedule-configuration'] }).map(({ key, label, href }) => ({ key, label, href }));
  const [data, createOptions] = await Promise.all([
    workOperations(db, organizationId, date, organization.timezone),
    organization.capabilities.includes('work_item.create') ? workCreateOptions(db, organizationId, assetsAvailable) : Promise.resolve(null),
  ]);
  return <WorkHome organizationId={organizationId} timezone={organization.timezone} data={data} createOptions={createOptions} shortcuts={shortcuts} configure={<WorkspaceConfigure organizationId={organizationId} workspace="field" />}
    activity={<WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="work" emptyMessage="No work activity yet." limit={5} dense/>}/>;
}
