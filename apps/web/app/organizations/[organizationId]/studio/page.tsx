import { StudioHome } from '@/features/studio/studio-home';
import { studioOverview } from '@/lib/application/studio/studio-overview';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function StudioPage({ params }: PageProps<'/organizations/[organizationId]/studio'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('organization.manage');
  const overview = await studioOverview(db, { organizationId, slug: organization.slug, organizationName: organization.name, mayManageWebsite: mayManage });
  return <StudioHome organizationId={organizationId} timezone={organization.timezone} mayManage={mayManage} overview={overview} />;
}
