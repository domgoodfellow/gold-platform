import { notFound } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { loadPlanDetail } from '@/lib/application/finance/plan-detail';
import { PlanDetailScreen } from '@/features/finance/plans/plan-detail-screen';

export const dynamic = 'force-dynamic';

export default async function FinancePlanDetailPage({ params }: PageProps<'/organizations/[organizationId]/finance/plans/[planKey]'>) {
  const { organizationId, planKey } = await params;
  await requirePlatformArea(organizationId, 'platform.commercial');
  const model = await loadPlanDetail(await getDb(), planKey);
  if (!model) notFound();
  return <PlanDetailScreen organizationId={organizationId} model={model} />;
}
