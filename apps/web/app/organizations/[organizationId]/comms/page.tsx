import { workspaceConfigureDoors } from '@/features/settings/workspace-configure';
import { ConfigureMenu } from '@/components/controls/configure-menu';
import { CommunicationsHome } from '@/features/communications/home/communications-home';
import { loadCommunicationsDashboard } from '@/lib/application/communications/dashboard';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

export default async function CommsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/comms'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOperatingArea(organizationId, 'comms');
  const data = await loadCommunicationsDashboard(db, { organizationId, timezone: organization.timezone, capabilities: organization.capabilities, query: await searchParams });
  const doors = await workspaceConfigureDoors(organizationId, 'communications');
  return <CommunicationsHome organizationId={organizationId} timezone={organization.timezone} data={data} setupHref={doors.find(door => door.key === 'phone-numbers')?.href} configure={<ConfigureMenu label="Communications settings" items={doors} />} />;
}
