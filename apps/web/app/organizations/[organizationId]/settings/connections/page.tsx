import { ConnectionsPage } from './connections-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function ConnectedAppsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/connections'>) {
  const { organizationId } = await params;
  const context = await requireOrganization(organizationId);
  return <ConnectionsPage organizationId={organizationId} query={await searchParams} context={context} />;
}
