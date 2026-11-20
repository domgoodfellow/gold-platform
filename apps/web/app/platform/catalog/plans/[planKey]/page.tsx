import { notFound } from 'next/navigation';
import { platformParams, requirePlatformArea } from '@/lib/route/platform';
import { getDb } from '@/lib/db/server';
import { loadPlanSwitches } from '@/lib/application/platform/plan-switches';
import { PlanSwitchesScreen } from '@/features/platform/plans/plan-switches-screen';

export const dynamic = 'force-dynamic';

export default async function PlatformPlanPage({ params }: PageProps<'/platform/catalog/plans/[planKey]'>) {
  const { organizationId, planKey } = await platformParams(params);
  await requirePlatformArea(organizationId, 'platform.catalogue');
  const model = await loadPlanSwitches(await getDb(), planKey);
  if (!model) notFound();
  return <PlanSwitchesScreen organizationId={organizationId} model={model} />;
}
