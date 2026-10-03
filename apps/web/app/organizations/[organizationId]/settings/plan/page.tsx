import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';
import { loadPlanUsage } from '@/lib/application/settings/plan-usage';
import { PlanUsageScreen } from '@/features/settings/plan-usage-screen';

export const dynamic = 'force-dynamic';

export default async function PlanAndUsagePage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/plan'>) {
  const { organizationId } = await params;
  const { checkout } = await searchParams;
  const { db, organization } = await requireOrganizationForBillingRecovery(organizationId);
  const model = await loadPlanUsage(db, {
    organizationId,
    currency: organization.currency,
    capabilities: organization.capabilities,
  });
  // The provider return is a return, not proof -- only the webhook-fed subscription row below
  // says whether this actually went through (work order C §6).
  const checkoutReturn = checkout === 'success' || checkout === 'canceled' ? checkout : null;
  return (
    <PlanUsageScreen
      organizationId={organizationId}
      currency={organization.currency}
      model={model}
      checkoutReturn={checkoutReturn}
    />
  );
}
