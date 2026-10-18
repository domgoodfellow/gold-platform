import { HomeDashboard } from '@/features/home/home-dashboard';
import { loadHome } from '@/lib/application/home/load';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params, searchParams }: PageProps<'/organizations/[organizationId]/home'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const data = await loadHome(db, organization, await searchParams);
  return <HomeDashboard key={`${organizationId}:${data.query.scope}:${data.query.attention}`} data={data} />;
}
