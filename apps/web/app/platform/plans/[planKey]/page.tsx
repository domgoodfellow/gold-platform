import { platformParams } from '@/lib/route/platform';
import { notFound } from 'next/navigation';
import { requirePlatformArea } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { loadPlanDetail } from '@/lib/application/platform/plan-detail';
import { PlanDetailScreen } from '@/features/platform/plans/plan-detail-screen';

export const dynamic = 'force-dynamic';

export default async function PlatformPlanDetailPage({ params }: PageProps<'/platform/plans/[planKey]'>) {
  const { organizationId, planKey } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.commercial');
  const model = await loadPlanDetail(await getDb(), planKey);
  if (!model) notFound();
  return <PlanDetailScreen organizationId={organizationId} model={model} />;
}
