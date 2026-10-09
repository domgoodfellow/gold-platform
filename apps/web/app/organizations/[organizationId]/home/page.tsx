import { HomeDashboard } from '@/features/home/home-dashboard';
import { OrganizationReadiness } from '@/features/setup/organization-readiness';
import { LaunchForm } from '@/features/setup/launch-form';
import { FinanceWorkflow } from '@/features/finance/finance-workflow';
import { loadHome } from '@/lib/application/home/load';
import { requireOrganization } from '@/lib/route/organization';
import { computeSetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { listUsableModules } from '@/lib/domain/tenancy/modules';

export const dynamic = 'force-dynamic';

export default async function HomePage({ params, searchParams }: PageProps<'/organizations/[organizationId]/home'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [data, setup] = await Promise.all([
    loadHome(db, organization, await searchParams),
    organization.operationalState === 'setup' ? Promise.all([
      computeSetupOverview(db, { organizationId }), listUsableModules(db, { organizationId }),
    ]) : null,
  ]);
  const capabilities = new Set(organization.capabilities);
  const readiness = setup ? <OrganizationReadiness key="setup" organizationId={organizationId} organizationName={organization.name} overview={setup[0]} agentAvailable={setup[1].has('drafting')} finishAction={setup[0].blockers.length === 0 && capabilities.has('organization.manage') ? <LaunchForm organizationId={organizationId} /> : undefined} /> : null;
  const creationActions = data.quickActions.some(a => a.key === 'invoice') ? <FinanceWorkflow key="invoice" organizationId={organizationId} kind="invoice" mayCreateWork={capabilities.has('work_item.create')} /> : undefined;
  return <HomeDashboard key={`${organizationId}:${data.query.scope}:${data.query.attention}`} data={data} readiness={readiness} creationActions={creationActions} />;
}
