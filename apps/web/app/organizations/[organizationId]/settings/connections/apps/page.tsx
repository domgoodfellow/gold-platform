import { ConnectionsPage } from '../connections-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function BrowseAppsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/connections/apps'>) {
  const { organizationId } = await params;
  const context = await requireOrganization(organizationId);
  return <ConnectionsPage organizationId={organizationId} view="browse" query={await searchParams} context={context} />;
}
