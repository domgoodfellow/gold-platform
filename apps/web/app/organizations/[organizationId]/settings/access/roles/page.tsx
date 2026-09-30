import { AccessPage } from '../access-page';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function RolesPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/access/roles'>) {
  const { organizationId } = await params;
  const context = await requireOrganization(organizationId);
  return <AccessPage organizationId={organizationId} view="roles" context={context} />;
}
