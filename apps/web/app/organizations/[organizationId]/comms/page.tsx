import { WorkspaceConfigure } from '@/features/settings/workspace-configure';
import { CommunicationsHome } from '@/features/communications/home/communications-home';
import { loadCommunicationsDashboard } from '@/lib/application/communications/dashboard';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function CommsPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/comms'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const data = await loadCommunicationsDashboard(db, { organizationId, timezone: organization.timezone, capabilities: organization.capabilities, query: await searchParams });
  return <CommunicationsHome organizationId={organizationId} timezone={organization.timezone} data={data} configure={<WorkspaceConfigure organizationId={organizationId} workspace="communications" />} />;
}
