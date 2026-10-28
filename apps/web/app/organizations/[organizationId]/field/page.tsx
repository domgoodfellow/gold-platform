import { WorkspaceConfigure } from '@/features/settings/workspace-configure';
import { requireOrganization } from '@/lib/route/organization';
import { workOperations } from '@/lib/application/work/operations';
import { WorkHome } from '@/features/work/home/work-home';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { parseScheduleDate } from '@/features/scheduling/calendar/schedule-url';
export const dynamic = 'force-dynamic';
/** The Work Dashboard: the selected day (`?on=`, in the organization's zone) and the one read model it shows. */
export default async function FieldPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/field'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const today = todayInZone(organization.timezone);
  const date = parseScheduleDate(query.on, today);
  const data = await workOperations(db, organizationId, date, organization.timezone);
  return <WorkHome organizationId={organizationId} timezone={organization.timezone} today={today} data={data} capabilities={organization.capabilities} configure={<WorkspaceConfigure organizationId={organizationId} workspace="field" size="small" compact />}
    activity={<WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="work" emptyMessage="No work activity yet." limit={5} dense/>}/>;
}
