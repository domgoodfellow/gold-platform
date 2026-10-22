import { WorkspaceConfigure } from '@/features/settings/workspace-configure';
import { requireOrganization } from '@/lib/route/organization';
import { workOperations } from '@/lib/application/work/operations';
import { WorkHome } from '@/features/work/home/work-home';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { parseScheduleDate } from '@/features/scheduling/calendar/schedule-url';
export const dynamic = 'force-dynamic';
export default async function FieldPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/field'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const date = parseScheduleDate(query.on, todayInZone(organization.timezone));
  const data = await workOperations(db, organizationId, date, organization.timezone);
  return <WorkHome organizationId={organizationId} timezone={organization.timezone} data={data} mayCreate={organization.capabilities.includes('work_item.create')} configure={<WorkspaceConfigure organizationId={organizationId} workspace="field" size="small" />}
    activity={<WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="work" emptyMessage="No work activity yet." limit={5} dense/>}/>;
}
