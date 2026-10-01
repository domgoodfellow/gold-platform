import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';
import { loadPlanUsage } from '@/lib/application/settings/plan-usage';
import { PlanUsageScreen } from '@/features/settings/plan-usage-screen';

export const dynamic = 'force-dynamic';

export default async function PlanAndUsagePage({ params }: PageProps<'/organizations/[organizationId]/settings/plan'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganizationForBillingRecovery(organizationId);
  const model = await loadPlanUsage(db, {
    organizationId,
    currency: organization.currency,
    capabilities: organization.capabilities,
  });
  return <PlanUsageScreen organizationId={organizationId} currency={organization.currency} model={model} />;
}
