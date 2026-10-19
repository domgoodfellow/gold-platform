import { HomeDashboard } from '@/features/home/home-dashboard';
import { SetupBanner } from '@/features/setup/setup-banner';
import { loadHome } from '@/lib/application/home/load';
import { computeSetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params, searchParams }: PageProps<'/organizations/[organizationId]/home'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const inSetup = organization.operationalState === 'setup';
  const [data, overview] = await Promise.all([
    loadHome(db, organization, await searchParams),
    inSetup ? computeSetupOverview(db, { organizationId }).catch(() => null) : null,
  ]);
  const setup = inSetup ? <SetupBanner organizationId={organizationId} overview={overview} mayLaunch={organization.capabilities.includes('organization.manage')} /> : null;
  return <HomeDashboard key={`${organizationId}:${data.query.scope}:${data.query.attention}`} data={data} setup={setup} />;
}
